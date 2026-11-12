// POST /api/t — rastreio de ações (visitas, cliques, vídeos, oferta) com a campanha de origem.
// GET  /api/t?o=<token>              — pixel de abertura dos convites (listas importadas)
// GET  /api/t?r=<token>&d=<disparo>&ch=e|w — clique no link do convite: marca e redireciona
// Público e leve: aceita só tipos conhecidos e corta os textos.
const { db, config, leadByToken } = require('./_lib/db');
const { readJson, handler, SITE_URL } = require('./_lib/http');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const TOKEN_C = /^[a-f0-9]{16,40}$/;
const agoraIso = () => new Date().toISOString();
const slug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

async function contatoGet(req, res) {
  const u = new URL(req.url, 'http://x');
  const o = u.searchParams.get('o'), r = u.searchParams.get('r');
  // Dados públicos que mudam pelo painel (aba Configurações): número do suporte no WhatsApp
  if (u.searchParams.get('cfg')) {
    const cfg = await config().catch(() => ({}));
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=60');
    return res.end(JSON.stringify({ whatsapp: String(cfg.whatsapp_suporte || '').replace(/\D/g, '') || null, inscricao_ate: Number(cfg.inscricao_ate || 3) }));
  }
  // /suporte — redireciona para o WhatsApp do suporte cadastrado no painel (troca o número sem mexer nas automações)
  if (u.searchParams.get('zap')) {
    const cfg = await config().catch(() => ({}));
    const n = String(cfg.whatsapp_suporte || '').replace(/\D/g, '');
    const msg = encodeURIComponent('Oi! Preciso de ajuda com a Semana do Barbeiro.');
    res.statusCode = 302; res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', n ? `https://wa.me/${n}?text=${msg}` : SITE_URL() + '/');
    return res.end();
  }
  if (o != null) {
    if (TOKEN_C.test(o)) {
      const c = await db.one('sdb_contatos', `select=id,aberto_em&token=eq.${o}`).catch(() => null);
      if (c && !c.aberto_em) await db.update('sdb_contatos', `id=eq.${c.id}`, { aberto_em: agoraIso() }).catch(() => {});
    }
    res.statusCode = 200; res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'no-store'); return res.end(GIF);
  }
  let destino = SITE_URL() + '/';
  if (TOKEN_C.test(r || '')) {
    const c = await db.one('sdb_contatos', `select=id,lista,bloco,aberto_em,clicado_em,token&token=eq.${r}`).catch(() => null);
    const dId = Number(u.searchParams.get('d'));
    const d = Number.isInteger(dId) ? await db.one('sdb_disparos', `select=link_tipo,canal&id=eq.${dId}`).catch(() => null) : null;
    const ch = u.searchParams.get('ch') === 'w' ? 'whatsapp' : 'email';
    if (c) {
      const patch = {}; if (!c.clicado_em) patch.clicado_em = agoraIso(); if (!c.aberto_em) patch.aberto_em = agoraIso();
      if (Object.keys(patch).length) await db.update('sdb_contatos', `id=eq.${c.id}`, patch).catch(() => {});
      const utm = `utm_source=${ch}&utm_medium=convite&utm_campaign=${encodeURIComponent(slug(`${c.lista} ${c.bloco || ''}`))}`;
      if (d?.link_tipo === 'barbeearia') {
        const cfg = await config();
        const base = cfg.barbeearia_convite_url || 'https://barbeearia.com.br/cadastro?codigo=ALUNOBS30';
        destino = `${base}${base.includes('?') ? '&' : '?'}c=${c.token}&${utm}`;
      } else destino = `${SITE_URL()}/?c=${c.token}&${utm}`;
    }
  }
  res.statusCode = 302; res.setHeader('Location', destino); res.setHeader('Cache-Control', 'no-store'); return res.end();
}

const TIPOS = new Set([
  'visita', 'cta_clique', 'quiz_inicio', 'cert_pix', 'cert_cartao', 'whatsapp_clique', 'instagram_clique',
  'app_aberto', 'roleta_vista', 'aula_play', 'oferta_vista', 'checkout_clique', 'saiba_mais_clique',
  'live_clique', 'grupo_clique', 'barberhub_vista', 'barberhub_clique', 'ja_participou',
]);
const corta = (v, n = 120) => (v == null ? null : String(v).replace(/[\u0000-\u001f]/g, '').slice(0, n) || null);

module.exports = handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') return contatoGet(req, res);
  const b = await readJson(req);
  const tipo = String(b.tipo || '');
  const sessao = String(b.sessao || '');
  res.statusCode = 204;
  if (!TIPOS.has(tipo) || !/^[a-z0-9]{8,40}$/i.test(sessao)) return res.end();
  const lead = b.token ? await leadByToken(String(b.token)).catch(() => null) : null;
  await db.insert('sdb_trilha', {
    sessao, lead_id: lead?.id || null, tipo, pagina: corta(b.pagina, 80), detalhe: corta(b.detalhe, 120),
    utm_source: corta(b.utm_source, 100), utm_medium: corta(b.utm_medium, 100), utm_campaign: corta(b.utm_campaign, 100), utm_content: corta(b.utm_content, 100),
    ref: corta(b.ref, 120),
  }).catch(e => console.error('trilha', e.message));
  res.end();
});
