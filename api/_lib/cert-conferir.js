// Rede de segurança do certificado: confere no Asaas as cobranças pendentes recentes e libera quem pagou
// e fechou a tela antes, mesmo se o webhook do Asaas falhar.
// Cuidado com a cota do Asaas (25 mil chamadas a cada 12 h, somando TODOS os sistemas que usam a mesma conta):
// roda no máximo a cada 15 min, só para cobranças dos últimos 3 dias, até 15 por vez.
const { db, config, logEvento } = require('./db');
const asaas = require('./asaas');
const manychat = require('./manychat');
const { comTimeout, agora } = require('./util');
const { SITE_URL } = require('./http');

async function marcarPago(l, status, cfg) {
  await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'pago', cert_paid_at: new Date().toISOString() });
  await logEvento('cert_pago_consulta', { lead_id: l.id, payload: { payment: l.cert_payment_id, status } }).catch(() => {});
  await comTimeout(manychat.sync(l, { tags: ['sdb_cert_pago'] }), 4000);
  await comTimeout(require('./meta').evento('Purchase', { lead: l, eventId: `cert_${l.id}`, valor: l.cert_valor || cfg.cert_preco || '19.70', url: `${SITE_URL()}/certificado` }), 3000);
}

// Pix promocional que passou do prazo: confere se foi pago; se não, exclui no Asaas e libera para gerar outro
async function expirarSePreciso(l, cfg) {
  if (l.cert_status !== 'pendente' || !l.cert_expira_em || Date.parse(l.cert_expira_em) > agora()) return l;
  const s = await comTimeout(asaas.situacao(l.cert_payment_id), 6000).catch(() => null);
  if (s?.pago) { await marcarPago(l, s.status, cfg); return { ...l, cert_status: 'pago' }; }
  if (!s) return l; // Asaas fora do ar: tenta de novo depois
  await asaas.cancelar(l.cert_payment_id).catch(e => console.error('cert cancelar', e.message));
  await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: null, cert_payment_id: null, cert_invoice_url: null, cert_expira_em: null });
  await logEvento('cert_pix_expirado', { lead_id: l.id, payload: { payment: l.cert_payment_id, valor: l.cert_valor } }).catch(() => {});
  return { ...l, cert_status: null, cert_payment_id: null, cert_invoice_url: null, cert_expira_em: null };
}

// Rodada do agendador: exclui os Pix promocionais vencidos (24 h do cadastro ou 10 min da última chance)
async function expirarVencidos() {
  if (!process.env.ASAAS_API_KEY) return 0;
  const cfg = await config();
  const ls = await db.select('sdb_leads', `select=*&cert_status=eq.pendente&cert_expira_em=lt.${encodeURIComponent(new Date(agora()).toISOString())}&limit=20`);
  for (const l of ls) await expirarSePreciso(l, cfg).catch(e => console.error('cert expirar', e.message));
  return ls.length;
}

async function conferirPendentes() {
  if (!process.env.ASAAS_API_KEY) return 0;
  const cfg = await config();
  if (Date.now() - (Date.parse(cfg.cert_conferido_em || '') || 0) < 15 * 60e3) return 0;
  await db.upsert('sdb_config', { chave: 'cert_conferido_em', valor: new Date().toISOString() }, 'chave');

  const desde = new Date(Date.now() - 3 * 86400e3).toISOString();
  const ev = await db.select('sdb_eventos', `select=lead_id&tipo=eq.cert_cobranca&created_at=gte.${encodeURIComponent(desde)}&order=created_at.desc&limit=200`);
  const ids = [...new Set(ev.map(e => e.lead_id).filter(Boolean))];
  if (!ids.length) return 0;
  const ls = await db.select('sdb_leads', `select=*&cert_status=eq.pendente&cert_payment_id=not.is.null&id=in.(${ids.join(',')})&limit=15`);
  let n = 0;
  for (const l of ls) {
    const s = await comTimeout(asaas.situacao(l.cert_payment_id), 5000);
    if (s?.pago) {
      await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'pago', cert_paid_at: new Date().toISOString() });
      await logEvento('cert_pago_consulta', { lead_id: l.id, payload: { payment: l.cert_payment_id, status: s.status, origem: 'agendador' } });
      await comTimeout(manychat.sync(l, { tags: ['sdb_cert_pago'] }), 4000);
      await comTimeout(require('./meta').evento('Purchase', { lead: l, eventId: `cert_${l.id}`, valor: cfg.cert_preco || '19.70' }), 3000);
      n++;
    } else if (s?.cancelado) {
      await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'cancelado' });
    }
  }
  return n;
}

module.exports = { conferirPendentes, expirarVencidos, expirarSePreciso, marcarPago };
