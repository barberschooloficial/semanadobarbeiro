// Webhook hotmart (chamado por /api/webhook?de=hotmart; /api/webhook-hotmart continua funcionando) — marca quem comprou o curso (oferta R$ 147)
// Configure na Hotmart: Ferramentas → Webhook (API e notificações) → versão 2.0,
// URL https://semanadobarbeiro.com.br/api/webhook-hotmart. Copie o "Hottok" para HOTMART_HOTTOK.
const crypto = require('crypto');
const { db, logEvento } = require('./db');
const { readJson, send, handler } = require('./http');
const { normalizaEmail } = require('./valida');
const manychat = require('./manychat');
const { comTimeout } = require('./util');

const STATUS = {
  PURCHASE_APPROVED: 'pago', PURCHASE_COMPLETE: 'pago',
  PURCHASE_BILLET_PRINTED: 'pendente', PURCHASE_DELAYED: 'pendente',
  PURCHASE_REFUNDED: 'reembolsado', PURCHASE_CHARGEBACK: 'reembolsado',
  PURCHASE_CANCELED: 'cancelado', PURCHASE_EXPIRED: 'cancelado',
};

function hottokOk(req, body) {
  const esperado = process.env.HOTMART_HOTTOK || '';
  const recebido = String(req.headers['x-hotmart-hottok'] || body.hottok || '');
  return esperado.length > 0 && esperado.length === recebido.length &&
    crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

module.exports = handler(['GET', 'POST'], async (req, res) => {
  // Validação da URL no cadastro do webhook: a Hotmart chama o endereço antes de existir evento.
  // Responde 200 sem fazer nada; nenhum dado é gravado sem o hottok conferido abaixo.
  if (req.method === 'GET') return send(res, 200, { ok: true, pronto: true });
  const b = await readJson(req);
  if (!b.event && !b.data) return send(res, 200, { ok: true, validacao: true });
  if (!hottokOk(req, b)) return send(res, 401, { erro: 'hottok inválido' });

  const status = STATUS[b.event];
  const d = b.data || {};
  const transacao = d.purchase?.transaction;
  if (!status || !transacao) return send(res, 200, { ok: true, ignorado: true });

  const produtoId = process.env.HOTMART_PRODUCT_ID;
  if (produtoId && String(d.product?.id) !== String(produtoId)) return send(res, 200, { ok: true, outroProduto: true });

  const novo = await logEvento(`hotmart_${b.event}`, { chave: `hotmart:${b.event}:${transacao}`, payload: { transacao, sck: d.purchase?.origin?.sck, valor: d.purchase?.price?.value } });
  if (!novo) return send(res, 200, { ok: true, duplicado: true });

  // 1º pelo sck (vem do app: sdb_<id do lead>), 2º pelo e-mail
  let lead = null;
  const m = String(d.purchase?.origin?.sck || '').match(/^sdb_([0-9a-f-]{36})$/);
  if (m) lead = await db.one('sdb_leads', `id=eq.${m[1]}&select=*`);
  const email = normalizaEmail(d.buyer?.email);
  if (!lead && email) lead = await db.one('sdb_leads', `email=eq.${encodeURIComponent(email)}&select=*&order=created_at.desc`);
  if (!lead) return send(res, 200, { ok: true, semLead: true });

  // Não rebaixa quem já pagou por causa de um evento atrasado de boleto
  if (lead.curso_status === 'pago' && status === 'pendente') return send(res, 200, { ok: true });

  await db.update('sdb_leads', `id=eq.${lead.id}`, {
    curso_status: status, curso_transacao: transacao,
    ...(status === 'pago' ? { curso_paid_at: new Date().toISOString() } : {}),
  });
  if (status === 'pago') await comTimeout(manychat.sync(lead, { tags: ['sdb_comprou_curso'] }), 4000);
  // Compra do curso na Meta pelo servidor: só com META_CAPI_HOTMART=1 (se o Pixel já estiver configurado no produto da Hotmart, deixe desligado para não contar 2 vezes)
  if (status === 'pago' && process.env.META_CAPI_HOTMART === '1') await comTimeout(require('./meta').evento('Purchase', { lead, eventId: `curso_${transacao}`, valor: d.purchase?.price?.value }), 3000);
  send(res, 200, { ok: true });
});
