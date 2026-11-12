// Trava de saque do Asaas (chamado por /api/webhook?de=asaas-saque; /api/asaas-saque também funciona)
// O sistema da Semana do Barbeiro só CRIA cobranças: nunca transfere, paga conta nem faz saque.
// Ligue no Asaas: Menu do usuário → Integrações → Mecanismos de segurança → "Validação de saque via webhook",
// com esta URL e o token igual à variável ASAAS_SAQUE_TOKEN. Valide SÓ as operações feitas pela API
// (deixe a validação da interface desligada, senão os seus saques pelo painel também seriam recusados).
// Efeito: se a chave de API vazar, qualquer transferência/saque/pagamento pedido pela API é RECUSADO aqui.
// Atenção: subcontas herdam essa configuração. Se um dia outro sistema seu precisar transferir pela API, ajuste antes.
const crypto = require('crypto');
const { logEvento } = require('./db');
const { readJson, send } = require('./http');

function tokenOk(req) {
  const esperado = process.env.ASAAS_SAQUE_TOKEN || '';
  const recebido = String(req.headers['asaas-access-token'] || '');
  return esperado.length > 0 && esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { ok: true, pronto: true });
  let b = {};
  try { b = await readJson(req); } catch {}
  const op = b.transfer || b.bill || b.pixQrCode || b.mobilePhoneRecharge || b.pixRefund || {};
  await logEvento('asaas_saque_recusado', {
    payload: { tipo: b.type || null, id: op.id || null, valor: op.value ?? null, token_ok: tokenOk(req) },
  }).catch(() => {});
  // Sempre recusa: este sistema não faz nenhuma operação de saída de dinheiro
  send(res, 200, { status: 'REFUSED', refuseReason: 'Operação de saída de dinheiro pela API não autorizada (Semana do Barbeiro só gera cobranças).' });
};
