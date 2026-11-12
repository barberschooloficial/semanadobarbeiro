// POST /api/certificado — gera a cobrança Asaas do Certificado (R$ 19,70) e devolve o Pix para pagar na página
// GET  /api/certificado?t=<token> — situação do pagamento (a página consulta enquanto mostra o QR Code)
const { db, config, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, handler, fail, SITE_URL, APP_URL } = require('./_lib/http');
const { cpfValido } = require('./_lib/valida');
const asaas = require('./_lib/asaas');
const manychat = require('./_lib/manychat');
const { comTimeout } = require('./_lib/util');

module.exports = handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const t = new URL(req.url, 'http://x').searchParams.get('t');
    const l = await leadByToken(t);
    if (!l) throw fail(401, 'Cadastro não encontrado.');
    // Pendente: confere no Asaas (o webhook pode atrasar ou não estar configurado)
    if (l.cert_status === 'pendente' && l.cert_payment_id) {
      const s = await comTimeout(asaas.situacao(l.cert_payment_id), 6000).catch(() => null);
      if (s?.pago) {
        await db.update('sdb_leads', `id=eq.${l.id}`, { cert_status: 'pago', cert_paid_at: new Date().toISOString() });
        await logEvento('cert_pago_consulta', { lead_id: l.id, payload: { payment: l.cert_payment_id, status: s.status } }).catch(() => {});
        await comTimeout(manychat.sync(l, { tags: ['sdb_cert_pago'] }), 4000);
        return send(res, 200, { status: 'pago' });
      }
    }
    return send(res, 200, { status: l.cert_status || null });
  }
  const b = await readJson(req);
  const lead = await leadByToken(b.token);
  if (!lead) throw fail(401, 'Cadastro não encontrado.');
  if (lead.cert_status === 'pago') return send(res, 200, { ok: true, pago: true });
  if (lead.cert_status === 'pendente' && lead.cert_invoice_url) return send(res, 200, { ok: true, invoiceUrl: lead.cert_invoice_url, pix: await asaas.pix(lead.cert_payment_id) });

  const cpf = cpfValido(b.cpf);
  if (!cpf) throw fail(400, 'CPF inválido. Ele é exigido para emitir a cobrança.');

  const cfg = await config();
  const voltaPara = b.origem === 'app' ? `${APP_URL()}/?t=${lead.token}&pago=certificado` : `${SITE_URL()}/obrigado?t=${lead.token}&pago=1`;
  const cob = await asaas.cobranca({
    lead, cpf,
    valor: cfg.cert_preco || '19.70',
    descricao: 'Certificado de Participação — Semana do Barbeiro (Barber School)',
    referencia: `cert:${lead.id}`,
    successUrl: voltaPara,
  });

  await db.update('sdb_leads', `id=eq.${lead.id}`, { cpf, cert_status: 'pendente', cert_payment_id: cob.id, cert_invoice_url: cob.invoiceUrl });
  await comTimeout(manychat.sync(lead, { tags: ['sdb_cert_pendente'], campos: { cert_link: cob.invoiceUrl } }), 4000);
  await logEvento('cert_cobranca', { lead_id: lead.id, payload: { payment: cob.id } });

  send(res, 200, { ok: true, invoiceUrl: cob.invoiceUrl, pix: await asaas.pix(cob.id) });
});
