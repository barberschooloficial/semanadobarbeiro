// Meta Conversions API (CAPI): manda para a Meta, pelo servidor, o cadastro (Lead) e as compras (Purchase).
// Complementa o Pixel do navegador: conta quem usa bloqueador, iPhone sem cookie e pagamentos que caem depois (Pix/webhook).
// Liga sozinho quando existirem na Vercel: META_PIXEL_ID (o mesmo do assets/config-publico.js) e META_CAPI_TOKEN
// (Gerenciador de Eventos → o pixel → Configurações → API de Conversões → Gerar token de acesso).
// Dados pessoais vão criptografados (SHA-256), como a Meta exige. O event_id evita contar duas vezes com o Pixel.
const crypto = require('crypto');
const { SITE_URL } = require('./http');

const h = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);
const ligado = () => !!(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);

async function evento(nome, { lead, req, eventId, valor, url, fbp, fbc, origem = 'website' } = {}) {
  if (!ligado() || !lead) return null;
  const partes = String(lead.nome || '').trim().split(/\s+/);
  const ip = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
  const user_data = {
    em: lead.email ? [h(lead.email)] : undefined,
    ph: lead.whatsapp ? [h(String(lead.whatsapp).replace(/\D/g, ''))] : undefined,
    fn: partes[0] ? [h(partes[0])] : undefined,
    ln: partes.length > 1 ? [h(partes[partes.length - 1])] : undefined,
    external_id: lead.id ? [h(lead.id)] : undefined,
    country: [h('br')],
    client_ip_address: ip,
    client_user_agent: req?.headers?.['user-agent'] || undefined,
    fbp: /^fb\.\d\.\d+\.\d+$/.test(String(fbp || '')) ? fbp : undefined,
    fbc: /^fb\.\d\.\d+\.[\w-]+$/.test(String(fbc || '')) ? fbc : undefined,
  };
  const corpo = {
    data: [{
      event_name: nome, event_time: Math.floor(Date.now() / 1000), action_source: origem,
      event_source_url: url || `${SITE_URL()}/`, event_id: eventId || undefined, user_data,
      custom_data: valor != null ? { value: Number(valor), currency: 'BRL' } : undefined,
    }],
    access_token: process.env.META_CAPI_TOKEN,
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  };
  const ver = process.env.META_API_VERSION || 'v26.0';
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(process.env.META_PIXEL_ID)}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    if (!r.ok) console.error('meta capi', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) { console.error('meta capi', e.message); return false; }
}

module.exports = { evento, ligado };
