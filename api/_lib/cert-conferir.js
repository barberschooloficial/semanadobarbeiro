// Rede de segurança do certificado: confere no Asaas as cobranças pendentes recentes e libera quem pagou
// e fechou a tela antes, mesmo se o webhook do Asaas falhar.
// Cuidado com a cota do Asaas (25 mil chamadas a cada 12 h, somando TODOS os sistemas que usam a mesma conta):
// roda no máximo a cada 15 min, só para cobranças dos últimos 3 dias, até 15 por vez.
const { db, config, logEvento } = require('./db');
const asaas = require('./asaas');
const manychat = require('./manychat');
const { comTimeout } = require('./util');

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

module.exports = { conferirPendentes };
