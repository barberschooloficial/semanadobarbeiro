// POST /api/certificado — gera a cobrança Asaas do Certificado e devolve o Pix para pagar na página
// GET  /api/certificado?t=<token> — situação do pagamento e preço atual (a página consulta enquanto mostra o QR Code)
// Preço: api/_lib/cert-preco.js (de R$ 47,70 por R$ 19,70 nas primeiras 24 h ou na última chance de 10 min, só Pix)
const { db, config, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, handler, fail, SITE_URL, APP_URL } = require('./_lib/http');
const { cpfValido } = require('./_lib/valida');
const asaas = require('./_lib/asaas');
const manychat = require('./_lib/manychat');
const { comTimeout, agora } = require('./_lib/util');
const { precoCert, publico } = require('./_lib/cert-preco');
const { marcarPago, expirarSePreciso } = require('./_lib/cert-conferir');

// A tela do Pix consulta a cada poucos segundos: no máximo 1 consulta ao Asaas a cada 10 s por cobrança
// (a cota do Asaas é da conta inteira e outros sistemas usam a mesma conta)
const ultimaConsulta = new Map();
function podeConsultar(id) {
  const t = Date.now(), ult = ultimaConsulta.get(id) || 0;
  if (t - ult < 10_000) return false;
  ultimaConsulta.set(id, t);
  if (ultimaConsulta.size > 5000) ultimaConsulta.clear();
  return true;
}

const ymdBR = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);

module.exports = handler(['GET', 'POST'], async (req, res) => {
  const cfg = await config();
  if (req.method === 'GET') {
    const t = new URL(req.url, 'http://x').searchParams.get('t');
    let l = await leadByToken(t);
    if (!l) throw fail(401, 'Cadastro não encontrado.');
    l = await expirarSePreciso(l, cfg);
    // Pendente: confere no Asaas (o webhook pode atrasar ou não estar configurado)
    if (l.cert_status === 'pendente' && l.cert_payment_id && podeConsultar(l.cert_payment_id)) {
      const s = await comTimeout(asaas.situacao(l.cert_payment_id), 6000).catch(() => null);
      if (s?.pago) { await marcarPago(l, s.status, cfg); return send(res, 200, { status: 'pago' }); }
    }
    return send(res, 200, { status: l.cert_status || null, expira: l.cert_expira_em || null, preco: publico(await precoCert(l, cfg)) });
  }

  const b = await readJson(req);
  let lead = await leadByToken(b.token);
  if (!lead) throw fail(401, 'Cadastro não encontrado.');
  if (lead.cert_status === 'pago') return send(res, 200, { ok: true, pago: true });
  lead = await expirarSePreciso(lead, cfg);
  if (lead.cert_status === 'pago') return send(res, 200, { ok: true, pago: true });
  const p = await precoCert(lead, cfg);

  // Cobrança em aberto com o preço de agora: devolve a mesma
  if (lead.cert_status === 'pendente' && lead.cert_invoice_url) {
    const mesmoPreco = !lead.cert_valor || Math.abs(Number(lead.cert_valor) - p.valor) < 0.01;
    if (mesmoPreco) {
      const pix = await asaas.pix(lead.cert_payment_id);
      if (pix && lead.cert_expira_em) pix.expira = lead.cert_expira_em;
      return send(res, 200, { ok: true, invoiceUrl: lead.cert_invoice_url, pix, preco: publico(p) });
    }
    // o preço mudou (ex.: abriu a última chance): troca a cobrança antiga pela nova
    const s = await comTimeout(asaas.situacao(lead.cert_payment_id), 6000).catch(() => null);
    if (s?.pago) { await marcarPago(lead, s.status, cfg); return send(res, 200, { ok: true, pago: true }); }
    await asaas.cancelar(lead.cert_payment_id).catch(e => console.error('cert cancelar', e.message));
  }

  const cpf = cpfValido(b.cpf || lead.cpf);
  if (!cpf) throw fail(400, 'CPF inválido. Ele é exigido para emitir a cobrança.');

  const voltaPara = b.origem === 'app' ? `${APP_URL()}/?t=${lead.token}&pago=certificado` : `${SITE_URL()}/obrigado?t=${lead.token}&pago=1`;
  const cob = await asaas.cobranca({
    lead, cpf, valor: p.valor,
    descricao: `Certificado de Participação — Semana do Barbeiro (Barber School)${p.promo ? ` · promocional de R$ ${p.cheio.toFixed(2).replace('.', ',')} por R$ ${p.valor.toFixed(2).replace('.', ',')}` : ''}`,
    referencia: `cert:${lead.id}`, successUrl: voltaPara,
    soPix: p.promo, vence: p.promo && p.ate ? ymdBR(p.ate) : null,
  });
  const expira = p.promo && p.ate ? new Date(p.ate).toISOString() : null;

  await db.update('sdb_leads', `id=eq.${lead.id}`, { cpf, cert_status: 'pendente', cert_payment_id: cob.id, cert_invoice_url: cob.invoiceUrl, cert_valor: p.valor, cert_expira_em: expira, cert_criado_em: new Date().toISOString() });
  await comTimeout(manychat.sync(lead, { tags: ['sdb_cert_pendente'], campos: { cert_link: cob.invoiceUrl } }), 4000);
  await logEvento('cert_cobranca', { lead_id: lead.id, payload: { payment: cob.id, valor: p.valor, fase: p.fase } });

  const pix = await asaas.pix(cob.id);
  if (pix && expira) pix.expira = expira;
  send(res, 200, { ok: true, invoiceUrl: cob.invoiceUrl, pix, preco: publico(p) });
});

