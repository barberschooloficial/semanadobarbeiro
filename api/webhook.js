// POST /api/webhook?de=asaas | ?de=hotmart — um endpoint só para os dois gateways
// (os endereços antigos /api/webhook-asaas e /api/webhook-hotmart são redirecionados para cá no vercel.json)
const asaas = require('./_lib/wh-asaas');
const hotmart = require('./_lib/wh-hotmart');

module.exports = (req, res) => {
  const de = new URL(req.url, 'http://x').searchParams.get('de');
  if (de === 'asaas') return asaas(req, res);
  if (de === 'hotmart') return hotmart(req, res);
  res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"erro":"gateway desconhecido"}');
};
