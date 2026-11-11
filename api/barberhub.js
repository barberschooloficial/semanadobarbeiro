// POST /api/barberhub — upsell da Barbeearia (ex-BarberHub) (Asaas: assinatura mensal ou pagamento único)
const { db, config, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, handler, fail, APP_URL } = require('./_lib/http');
const { cpfValido } = require('./_lib/valida');
const asaas = require('./_lib/asaas');

module.exports = handler(['POST'], async (req, res) => {
  const b = await readJson(req);
  const lead = await leadByToken(b.token);
  if (!lead) throw fail(401, 'Cadastro não encontrado.');
  if (lead.barberhub_status === 'pago') return send(res, 200, { ok: true, pago: true });
  if (lead.barberhub_status === 'pendente' && lead.barberhub_invoice_url) return send(res, 200, { ok: true, invoiceUrl: lead.barberhub_invoice_url });

  const cpf = cpfValido(b.cpf || lead.cpf);
  if (!cpf) throw fail(400, 'CPF inválido.');

  const cfg = await config();
  const params = {
    lead, cpf,
    valor: cfg.barberhub_preco,
    descricao: 'Barbeearia — Sistema de gestão para barbearia (plano Barbeiro)',
    referencia: `barberhub:${lead.id}`,
    successUrl: `${APP_URL()}/?t=${lead.token}&pago=barberhub`,
  };
  const cob = cfg.barberhub_ciclo === 'UNICO' ? await asaas.cobranca(params) : await asaas.assinatura(params);

  await db.update('sdb_leads', `id=eq.${lead.id}`, { cpf, barberhub_status: 'pendente', barberhub_payment_id: cob.id, barberhub_invoice_url: cob.invoiceUrl });
  await logEvento('barberhub_cobranca', { lead_id: lead.id, payload: { id: cob.id } });

  send(res, 200, { ok: true, invoiceUrl: cob.invoiceUrl });
});
