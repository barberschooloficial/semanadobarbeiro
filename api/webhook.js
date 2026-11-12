// POST /api/webhook?de=asaas | ?de=hotmart — um endpoint só para os dois gateways
// (os endereços antigos /api/webhook-asaas e /api/webhook-hotmart são redirecionados para cá no vercel.json)
const asaas = require('./_lib/wh-asaas');
const hotmart = require('./_lib/wh-hotmart');
const saque = require('./_lib/wh-asaas-saque');
const resend = require('./_lib/wh-resend');

module.exports = (req, res) => {
  const de = new URL(req.url, 'http://x').searchParams.get('de');
  if (de === 'asaas') return asaas(req, res);
  if (de === 'hotmart') return hotmart(req, res);
  if (de === 'resend') return resend.handler(req, res); // entregue / devolvido / spam dos e-mails
  if (de === 'asaas-saque') return saque(req, res); // trava: recusa qualquer saque/transferência pedido pela API
  res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"erro":"gateway desconhecido"}');
};
