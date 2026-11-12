// Rede de segurança do certificado: a cada rodada do agendador (5 min), confere no Asaas as cobranças
// pendentes mais recentes. Libera quem pagou e fechou a tela antes, mesmo se o webhook do Asaas falhar.
const { db, logEvento } = require('./db');
const asaas = require('./asaas');
const manychat = require('./manychat');
const { comTimeout } = require('./util');

async function conferirPendentes() {
  if (!process.env.ASAAS_API_KEY) return 0;
  // as 40 cobranças pendentes mais recentes (cadastros mais novos primeiro)
  const ls = await db.select('sdb_leads', 'select=*&cert_status=eq.pendente&cert_payment_id=not.is.null&order=created_at.desc&limit=40');
  let n = 0;
  for (const l of ls) {
    const s = await comTimeout(asaas.situacao(l.cert_payment_id), 5000);
    if (s?.pago) {
      await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'pago', cert_paid_at: new Date().toISOString() });
      await logEvento('cert_pago_consulta', { lead_id: l.id, payload: { payment: l.cert_payment_id, status: s.status, origem: 'agendador' } });
      await comTimeout(manychat.sync(l, { tags: ['sdb_cert_pago'] }), 4000);
      n++;
    } else if (s?.cancelado) {
      await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'cancelado' });
    }
  }
  return n;
}

module.exports = { conferirPendentes };
