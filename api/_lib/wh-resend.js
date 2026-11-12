// Webhook do Resend (chamado por /api/webhook?de=resend&k=<chave>): marca e-mail entregue, devolvido (bounce) ou denunciado como spam.
// Alimenta a régua dos disparos (enviados → entregues → abertos → cliques).
// Cadastre no Resend: Webhooks → Add endpoint → URL que aparece no painel (Configurações → Chaves de API),
// eventos email.delivered, email.bounced e email.complained.
const crypto = require('crypto');
const { db, logEvento } = require('./db');
const { readJson, send } = require('./http');

// Chave da URL derivada do CRON_SECRET (não precisa de variável nova na Vercel e não expõe o segredo em si)
function chave() {
  const s = process.env.CRON_SECRET || '';
  return s.length >= 16 ? crypto.createHash('sha256').update(`resend-webhook:${s}`).digest('hex').slice(0, 32) : '';
}
function chaveOk(req) {
  const esperado = chave(), recebido = String(new URL(req.url, 'http://x').searchParams.get('k') || '');
  return esperado.length > 0 && esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}
const url = (base) => chave() ? `${base}/api/webhook?de=resend&k=${chave()}` : null;

async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { ok: true, pronto: true });
  if (!chaveOk(req)) return send(res, 401, { erro: 'chave inválida' });
  const b = await readJson(req);
  const id = String(b?.data?.email_id || '').slice(0, 80);
  const tipo = String(b?.type || '');
  if (!id || !/^[\w-]+$/.test(id)) return send(res, 200, { ok: true, ignorado: true });
  const q = `resend_id=eq.${encodeURIComponent(id)}`;
  let patch = null;
  if (tipo === 'email.delivered') patch = { entregue_em: new Date().toISOString() };
  else if (tipo === 'email.bounced') patch = { devolvido: true };
  else if (tipo === 'email.complained') patch = { devolvido: true };
  if (!patch) return send(res, 200, { ok: true, ignorado: true });
  const [c, l] = await Promise.all([
    db.update('sdb_contato_envios', q, patch).catch(() => []),
    db.update('sdb_disparo_envios', q, patch).catch(() => []),
  ]);
  // denúncia de spam ou endereço que não existe: não manda mais e-mail para essa pessoa
  if (tipo !== 'email.delivered') {
    for (const e of c || []) await db.update('sdb_contatos', `id=eq.${e.contato_id}`, { email_optout: true }).catch(() => {});
    for (const e of l || []) await db.update('sdb_leads', `id=eq.${e.lead_id}`, { email_optout: true }).catch(() => {});
    await logEvento(`resend_${tipo.replace('email.', '')}`, { payload: { id, contatos: (c || []).length, leads: (l || []).length } }).catch(() => {});
  }
  send(res, 200, { ok: true });
}

module.exports = { handler, url };
