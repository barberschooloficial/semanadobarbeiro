// Prospecção mensal de barbearias no Google Maps pela Apify (ator compass~crawler-google-places).
// Roda sozinha dentro do agendador (a cada 5 min): uma cidade por vez, respeitando o teto de gasto do mês
// (por padrão, dentro dos US$ 5 grátis da Apify). Cada barbearia entra na lista "barbearias_maps" da aba Leads.
// Os telefones são de empresa e NÃO recebem WhatsApp frio: entram com wa_optout = true. O convite é só por e-mail,
// com descadastro em todo envio, e o WhatsApp só acontece depois que a pessoa se cadastra no site.
const { db, config } = require('./db');
const { normalizaWhats, normalizaEmail, limpaTexto } = require('./valida');
const { localDe } = require('./regiao');

const API = 'https://api.apify.com/v2';
const LISTA = 'barbearias_maps';
const CIDADES_PADRAO = 'São Paulo, SP; Rio de Janeiro, RJ; Brasília, DF; Fortaleza, CE; Salvador, BA; Belo Horizonte, MG; Manaus, AM; Curitiba, PR; Recife, PE; Goiânia, GO; Porto Alegre, RS; Belém, PA';
const mesBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);

async function apify(caminho, { method = 'GET', body } = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN não configurada na Vercel');
  const r = await fetch(`${API}${caminho}${caminho.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Apify ${r.status}`);
  return j;
}

function opcoes(cfg) {
  return {
    ativo: cfg.prosp_ativo === '1',
    cidades: String(cfg.prosp_cidades || CIDADES_PADRAO).split(/[;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 50),
    porCidade: Math.min(500, Math.max(5, Number(cfg.prosp_por_cidade || 60))),
    teto: Math.max(0.5, Number(cfg.prosp_teto_usd || 4.5)),
    busca: String(cfg.prosp_busca || 'barbearia').trim() || 'barbearia',
    contatos: cfg.prosp_contatos !== '0',
    actor: String(cfg.prosp_actor || 'compass~crawler-google-places').trim(),
  };
}

async function estado(cfg) {
  try { return JSON.parse(cfg.prosp_estado || '{}'); } catch { return {}; }
}
async function salvar(e) {
  await db.upsert('sdb_config', { chave: 'prosp_estado', valor: JSON.stringify(e) }, 'chave');
  config.limpar();
}

async function gastoMes() {
  const l = await apify('/users/me/limits');
  return { usado: Number(l?.data?.current?.monthlyUsageUsd || 0), limite: Number(l?.data?.limits?.maxMonthlyUsageUsd || 0), ciclo: l?.data?.monthlyUsageCycle?.startAt || null };
}

const primeiro = (v) => Array.isArray(v) ? v.find(Boolean) : v;
function contatoDe(p, cidadePesquisa) {
  const email = normalizaEmail(primeiro(p.emails) || p.email || '') || null;
  const whatsapp = normalizaWhats(p.phoneUnformatted || p.phone || primeiro(p.phones) || '') || null;
  if (!email && !whatsapp) return null;
  const [cidadeQ, ufQ] = cidadePesquisa.split(',').map(s => s.trim());
  const { uf, regiao } = localDe(whatsapp, ufQ || p.state);
  const insta = primeiro(p.instagrams) || primeiro(p.instagram) || null;
  return {
    lista: LISTA, nome: limpaTexto(p.title || '', 80) || null, whatsapp, email,
    cidade: limpaTexto(p.city || cidadeQ || '', 80) || null, uf, regiao,
    wa_optout: true, // empresa tirada do Google Maps: sem WhatsApp frio
    extra: { origem: 'apify_google_maps', busca: cidadePesquisa, instagram: insta, site: p.website || null, endereco: p.address || null, nota: p.totalScore ?? null, avaliacoes: p.reviewsCount ?? null, maps: p.url || null, categoria: p.categoryName || null },
  };
}

async function importar(itens, cidade) {
  const novos = [], vistos = new Set();
  for (const p of itens) {
    const c = contatoDe(p, cidade); if (!c) continue;
    const k = c.email ? `e${c.email}` : `w${c.whatsapp}`;
    if (vistos.has(k)) continue; vistos.add(k); novos.push(c);
  }
  const q = (vals) => `in.(${vals.map(v => `"${v}"`).join(',')})`;
  const ja = new Set();
  for (let i = 0; i < novos.length; i += 150) {
    const p = novos.slice(i, i + 150);
    const ws = p.map(c => c.whatsapp).filter(Boolean), es = p.map(c => c.email).filter(Boolean);
    if (ws.length) (await db.select('sdb_contatos', `select=whatsapp&lista=eq.${LISTA}&whatsapp=${encodeURIComponent(q(ws))}`)).forEach(r => ja.add(`w${r.whatsapp}`));
    if (es.length) (await db.select('sdb_contatos', `select=email&lista=eq.${LISTA}&email=${encodeURIComponent(q(es))}`)).forEach(r => ja.add(`e${r.email}`));
  }
  const inserir = novos.filter(c => !(c.whatsapp && ja.has(`w${c.whatsapp}`)) && !(c.email && ja.has(`e${c.email}`)));
  for (let i = 0; i < inserir.length; i += 500) await db.insert('sdb_contatos', inserir.slice(i, i + 500));
  return { itens: itens.length, importados: inserir.length, com_email: inserir.filter(c => c.email).length };
}

// Um passo por chamada do agendador: confere o run em andamento ou começa a próxima cidade.
async function passo({ forcar = false } = {}) {
  const cfg = await config();
  const o = opcoes(cfg);
  if ((!o.ativo && !forcar) || !process.env.APIFY_TOKEN) return { pulado: !process.env.APIFY_TOKEN ? 'sem APIFY_TOKEN' : 'desligado' };
  let e = await estado(cfg);
  const mes = mesBR();
  if (e.mes !== mes) {
    // rodízio: o mês novo começa pela cidade em que o teto parou no mês anterior
    const p = (e.ponteiro || 0) % Math.max(1, o.cidades.length);
    e = { mes, fila: o.cidades.slice(p).concat(o.cidades.slice(0, p)), feitos: [], run: null, parado: null, ponteiro: p };
  }

  if (e.run) {
    const r = await apify(`/actor-runs/${encodeURIComponent(e.run.id)}`);
    const st = r?.data?.status;
    if (['READY', 'RUNNING'].includes(st)) return { aguardando: e.run.cidade };
    let res = { itens: 0, importados: 0, com_email: 0 };
    if (r?.data?.defaultDatasetId) {
      const itens = await apify(`/datasets/${r.data.defaultDatasetId}/items?clean=true&limit=${o.porCidade * 2}`);
      res = await importar(Array.isArray(itens) ? itens : [], e.run.cidade);
    }
    e.feitos.push({ cidade: e.run.cidade, status: st, custo: Number(r?.data?.usageTotalUsd || 0), ...res, em: new Date().toISOString() });
    e.run = null;
    await salvar(e);
    return { concluido: e.feitos[e.feitos.length - 1] };
  }

  if (!e.fila.length) { if (!e.parado) { e.parado = 'todas as cidades do mês prontas'; await salvar(e); } return { fim: e.parado }; }
  const g = await gastoMes();
  const sobra = o.teto - g.usado;
  if (sobra < 0.3) { e.parado = `teto do mês atingido (US$ ${g.usado.toFixed(2)} de ${o.teto.toFixed(2)})`; await salvar(e); return { fim: e.parado }; }

  const cidade = e.fila.shift();
  e.ponteiro = (o.cidades.indexOf(cidade) + 1) % Math.max(1, o.cidades.length);
  const input = {
    searchStringsArray: [o.busca], locationQuery: `${cidade}, Brasil`, maxCrawledPlacesPerSearch: o.porCidade,
    language: 'pt-BR', skipClosedPlaces: true, scrapePlaceDetailPage: false,
    scrapeContacts: o.contatos, scrapeSocialMediaProfiles: { instagrams: o.contatos, facebooks: false, tiktoks: false, twitters: false, youtubes: false },
  };
  // maxTotalChargeUsd: a própria Apify para o run se o custo passar da sobra do mês
  const run = await apify(`/acts/${encodeURIComponent(o.actor)}/runs?maxTotalChargeUsd=${Math.max(0.1, sobra - 0.2).toFixed(2)}&maxItems=${o.porCidade}`, { method: 'POST', body: input });
  e.run = { id: run?.data?.id, cidade, inicio: new Date().toISOString() };
  e.parado = null;
  await salvar(e);
  return { iniciado: cidade };
}

async function resumo() {
  const cfg = await config();
  const o = opcoes(cfg);
  const e = await estado(cfg);
  let gasto = null, erro = null;
  if (process.env.APIFY_TOKEN) gasto = await gastoMes().catch(x => { erro = x.message; return null; });
  const total = (await db.select('sdb_contatos', `select=id&lista=eq.${LISTA}&limit=1`).catch(() => [])).length;
  return { opcoes: o, estado: e, gasto, erro, token_ok: !!process.env.APIFY_TOKEN, lista: LISTA, tem_contatos: total > 0 };
}

module.exports = { passo, resumo, LISTA, CIDADES_PADRAO };
