// Preço do certificado (regra única para site, app, cobrança e mensagens):
// - nas primeiras 24 h depois do cadastro: de R$ 47,70 por R$ 19,70 (Pix ou cartão; boleto nunca);
// - depois: R$ 47,70;
// - última chance: quem recebeu o link da Bia depois das 24 h tem 10 min, contados de quando abre o link,
//   para pagar R$ 19,70 no Pix. Pix promocional não pago no prazo é excluído no Asaas (cert-conferir.expirar).
const { db, logEvento } = require('./db');
const { agora } = require('./util');

const num = (v, pad) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : pad; };

async function eventoDe(lead, tipo) {
  return db.one('sdb_eventos', `select=created_at,payload&tipo=eq.${tipo}&lead_id=eq.${lead.id}&order=created_at.asc`).catch(() => null);
}

// { valor, cheio, promo (bool), fase: promo | ultima | ultima_disponivel | cheio, ate (ms) }
async function precoCert(lead, cfg, t = agora()) {
  const promoV = num(cfg.cert_preco, 19.7), cheio = num(cfg.cert_preco_cheio, 47.7);
  const horas = num(cfg.cert_promo_horas, 24), minUlt = num(cfg.cert_ultima_min, 10);
  if (!(cheio > promoV)) return { valor: promoV, cheio: promoV, promo: false, fase: 'cheio' }; // sem promoção configurada
  const fimPromo = Date.parse(lead.created_at) + horas * 3600e3;
  if (t < fimPromo) return { valor: promoV, cheio, promo: true, fase: 'promo', ate: fimPromo };
  if (await eventoDe(lead, 'cert_uc_liberada')) {
    const aberta = await eventoDe(lead, 'cert_uc_aberta');
    // link ainda não aberto: o preço continua cheio até a pessoa abrir o link da Bia
    if (!aberta) return { valor: cheio, cheio, promo: false, fase: 'ultima_disponivel', minutos: minUlt };
    const ate = (Number(aberta.payload?.em) || Date.parse(aberta.created_at)) + minUlt * 60e3;
    if (t < ate) return { valor: promoV, cheio, promo: true, fase: 'ultima', ate };
  }
  return { valor: cheio, cheio, promo: false, fase: 'cheio' };
}

// A pessoa abriu o link da última chance: começa a contar os 10 min (uma vez só)
async function abrirUltima(lead) {
  if (!(await eventoDe(lead, 'cert_uc_liberada'))) return false;
  await logEvento('cert_uc_aberta', { lead_id: lead.id, chave: `cert_uc_aberta:${lead.id}`, payload: { em: agora() } });
  return true;
}

// Para a tela: o que mostrar ao lado do preço
function publico(p) {
  return { valor: p.valor, cheio: p.cheio, promo: p.promo, fase: p.fase, ate: p.ate ? new Date(p.ate).toISOString() : null, minutos: p.minutos || null };
}

module.exports = { precoCert, abrirUltima, publico };
