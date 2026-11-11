// Webhook asaas (chamado por /api/webhook?de=asaas; /api/webhook-asaas continua funcionando) — confirma pagamentos do Certificado e da Barbeearia
// Configure no Asaas: Integrações → Webhooks → URL https://semanadobarbeiro.com.br/api/webhook-asaas
// com o token de autenticação igual à variável ASAAS_WEBHOOK_TOKEN.
const crypto = require('crypto');
const { db, logEvento } = require('./db');
const { readJson, send, handler } = require('./http');
const manychat = require('./manychat');
const { comTimeout } = require('./util');

const PAGO = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
const ESTORNO = ['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_DELETED'];

function tokenOk(req) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN || '';
  const recebido = String(req.headers['asaas-access-token'] || '');
  return esperado.length > 0 && esperado.length === recebido.length &&
    crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

async function acharLead(p) {
  const ref = String(p.externalReference || '');
  const m = ref.match(/^(cert|barberhub):([0-9a-f-]{36})$/);
  if (m) return { produto: m[1], lead: await db.one('sdb_leads', `id=eq.${m[2]}&select=*`) };
  if (p.subscription) {
    const lead = await db.one('sdb_leads', `barberhub_payment_id=eq.${encodeURIComponent(p.subscription)}&select=*`);
    if (lead) return { produto: 'barberhub', lead };
  }
  const lead = await db.one('sdb_leads', `cert_payment_id=eq.${encodeURIComponent(p.id)}&select=*`);
  return { produto: lead ? 'cert' : null, lead };
}

module.exports = handler(['GET', 'POST'], async (req, res) => {
  // O Asaas testa o endereço antes de ativar o webhook: responde 200 sem gravar nada.
  if (req.method === 'GET') return send(res, 200, { ok: true, pronto: true });
  if (!tokenOk(req)) return send(res, 401, { erro: 'token inválido' });
  const b = await readJson(req);
  const p = b.payment || {};
  if (!p.id || (!PAGO.includes(b.event) && !ESTORNO.includes(b.event))) return send(res, 200, { ok: true, ignorado: true });

  const novo = await logEvento(`asaas_${b.event}`, { chave: `asaas:${b.event}:${p.id}`, payload: { id: p.id, ref: p.externalReference, value: p.value, sub: p.subscription } });
  if (!novo) return send(res, 200, { ok: true, duplicado: true });

  const { produto, lead } = await acharLead(p);
  if (!lead || !produto) return send(res, 200, { ok: true, semLead: true });

  const pago = PAGO.includes(b.event);
  const agora = new Date().toISOString();
  if (produto === 'cert') {
    await db.update('sdb_leads', `id=eq.${lead.id}`, pago ? { cert_status: 'pago', cert_paid_at: agora } : { cert_status: 'cancelado' });
    if (pago) await comTimeout(manychat.sync(lead, { tags: ['sdb_cert_pago'] }), 4000);
  } else {
    await db.update('sdb_leads', `id=eq.${lead.id}`, pago ? { barberhub_status: 'pago', barberhub_paid_at: agora } : { barberhub_status: 'cancelado' });
    if (pago) await comTimeout(manychat.sync(lead, { tags: ['sdb_barberhub_pago'] }), 4000);
  }
  send(res, 200, { ok: true });
});
