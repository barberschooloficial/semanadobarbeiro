// MODO LOCAL: banco em arquivo JSON que imita o Supabase (só as consultas que o sistema usa).
// Ativado com SDB_LOCAL=1. Nunca é usado na Vercel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQ = process.env.SDB_LOCAL_DB || path.join(process.cwd(), 'local', 'dados-local.json');


function seed() {
  const aulas = [
    [1, 1, 'Equipamentos básicos do barbeiro', 'O que você precisa ter na bancada para começar.', 15, '2026-11-02T08:00:00-03:00'],
    [2, 1, 'Tudo sobre pentes', 'Qual pente usar em cada etapa do corte.', 12, '2026-11-02T08:00:00-03:00'],
    [3, 2, 'Corte Mid Fade com Pompadour', 'Passo a passo completo do degradê médio.', 25, '2026-11-03T08:00:00-03:00'],
    [4, 2, 'Dicas sobre tesouras', 'Como escolher, usar e cuidar das tesouras, na live do professor Cris Aita.', null, '2026-11-03T08:00:00-03:00'],
    [5, 3, 'Como cortar cabelo com muito redemoinho', 'A dica que resolve o redemoinho sem estragar o corte.', 12, '2026-11-04T08:00:00-03:00'],
    [6, 3, 'Corte Razor Part', 'Risca na navalha com segurança.', 15, '2026-11-04T08:00:00-03:00'],
    [7, 4, 'Barba passo a passo', 'Preparação, toalha quente, desenho e acabamento.', 20, '2026-11-05T08:00:00-03:00'],
    [8, 4, 'Flat Top com High Fade', 'Corte clássico com degradê alto.', 25, '2026-11-05T08:00:00-03:00'],
    [9, 5, 'High Fade em "V" atrás', 'Degradê alto com acabamento em V na nuca.', 20, '2026-11-06T08:00:00-03:00'],
    [10, 5, 'Progressiva masculina na barbearia', 'Um serviço a mais para aumentar o ticket da cadeira.', 20, '2026-11-06T08:00:00-03:00'],
  ].map(([ordem, dia, titulo, descricao, duracao_min, libera_em]) => ({
    id: ordem, ordem, dia, titulo, descricao, duracao_min, libera_em, ativo: true, youtube_id: 'M7lc1UVf-VE',
  }));
  const cfg = {
    semana_inicio: '2026-11-02T08:00:00-03:00',
    aulas_expiram_em: '2026-11-08T23:59:00-03:00',
    oferta_abre_em: '2026-11-06T08:00:00-03:00',
    oferta_fecha_em: '2026-11-08T23:59:00-03:00',
    curso_preco_de: '297', curso_preco_por: '147',
    curso_parcelas: 'ou parcelado em até 12x no cartão',
    hotmart_checkout_url: process.env.SDB_HOTMART_DEMO_URL || 'http://localhost:3000/_simulador/hotmart?off=147',
    cert_preco: '19.70', barberhub_preco: '37.00', barberhub_ciclo: 'MONTHLY',
    premio_barbeearia_url: 'https://barbeearia.com.br', premio_clube_url: 'https://clubdobarbeiro.com.br', premio_vitalicio_cupom: 'VITALICIO',
    mc_flow_modulo_1: '', mc_flow_modulo_2: '', mc_flow_modulo_3: '', mc_flow_modulo_4: '', mc_flow_modulo_5: '', mc_flow_lembrete: '', mc_flow_oferta: '', mc_flow_ultima: '', whatsapp_custo_usd: '0.0718',
    aula_hora: '08:00', live_dias: '1,5', live_inicio: '19:00', live_fim: '20:00', disparos_auto: '1', curso_site_url: 'https://www.barberschool.com.br', mc_flow_live: '', mc_flow_convite: '', mc_flow_barbeearia: '', barbeearia_convite_url: 'https://barbeearia.com.br/cadastro?codigo=ALUNOBS30',
    grupo_whatsapp_url: '', live_url: 'https://www.instagram.com/barberschooloficial/', live_horario: '20h', grupos_auto: '1', whatsapp_suporte: '', wa_limite_dia: '4', wa_intervalo_min: '20', wa_intervalo_max: '90',
  };
  return {
    sdb_leads: [], sdb_progresso: [], sdb_eventos: [], sdb_roleta: [], sdb_disparos: [], sdb_disparo_envios: [], sdb_trilha: [], sdb_contatos: [], sdb_contato_envios: [], sdb_wa_destinos: [], sdb_wa_avisos: [], sdb_wa_aviso_envios: [],
    sdb_aulas: aulas,
    sdb_config: Object.entries(cfg).map(([chave, valor]) => ({ chave, valor })),
  };
}

let D = null;
let SEM_SALVAR = false;
function load() {
  if (D) return D;
  try { D = JSON.parse(fs.readFileSync(ARQ, 'utf8')); }
  catch { D = seed(); save(); }
  return D;
}
function save() {
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify(D, null, 2));
}
function reset() { D = seed(); save(); }

// ---- interpretador mínimo das consultas estilo PostgREST usadas no código ----
function parse(query) {
  const q = new URLSearchParams(query || '');
  const filtros = [], out = { filtros, order: null, limit: null, offset: 0, select: '*' };
  for (const [k, v] of q) {
    if (k === 'select') out.select = v;
    else if (k === 'order') out.order = v;
    else if (k === 'limit') out.limit = Number(v);
    else if (k === 'offset') out.offset = Number(v);
    else if (k === 'on_conflict') out.onConflict = v;
    else filtros.push([k, v]);
  }
  return out;
}
function casa(row, filtros) {
  return filtros.every(([col, cond]) => {
    const [op, ...resto] = cond.split('.');
    const val = resto.join('.');
    const atual = row[col];
    if (op === 'eq') return String(atual) === val;
    if (op === 'is') return val === 'null' ? atual == null : String(atual) === val;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(atual));
    if (op === 'neq') return String(atual) !== val;
    if (['lt', 'lte', 'gt', 'gte'].includes(op)) {
      if (atual == null) return false;
      const a = isNaN(Number(atual)) ? String(atual) : Number(atual), b = isNaN(Number(val)) ? val : Number(val);
      const [x, y] = typeof a === 'string' && /^\d{4}-/.test(a) ? [Date.parse(a), Date.parse(val)] : [a, b];
      return op === 'lt' ? x < y : op === 'lte' ? x <= y : op === 'gt' ? x > y : x >= y;
    }
    return true;
  });
}
function funil(d) {
  const L = d.sdb_leads;
  return [{
    cadastros: L.length,
    quiz_respondido: L.filter(l => l.quiz_at).length,
    certificados_pagos: L.filter(l => l.cert_status === 'pago').length,
    cursos_vendidos: L.filter(l => l.curso_status === 'pago').length,
    barberhub_vendidos: L.filter(l => l.barberhub_status === 'pago').length,
    acessaram_app: L.filter(l => l.last_seen_at).length,
    assistiram_1_aula: new Set(d.sdb_progresso.map(p => p.lead_id)).size,
  }];
}

function linhas(table, query) {
  const d = load();
  const q = parse(query);
  if (table === 'sdb_funil') return funil(d);
  let rows = (d[table] || []).filter(r => casa(r, q.filtros));
  if (q.order) {
    const [col, dir] = q.order.split('.');
    rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  if (q.offset || q.limit) rows = rows.slice(q.offset || 0, q.limit ? (q.offset || 0) + q.limit : undefined);
  rows = rows.map(r => ({ ...r }));
  if (/sdb_progresso\(count\)/.test(q.select)) {
    rows.forEach(r => { r.sdb_progresso = [{ count: d.sdb_progresso.filter(p => p.aula_id === r.id).length }]; });
  }
  return rows;
}

function erroDuplicado() { const e = new Error('duplicate key'); e.code = '23505'; e.status = 409; return e; }

function novoRegistro(table, row) {
  const r = { ...row };
  if (table === 'sdb_leads') {
    r.id = r.id || crypto.randomUUID();
    r.token = r.token || crypto.randomBytes(18).toString('hex');
    r.created_at = r.created_at || new Date().toISOString();
  }
  if (table === 'sdb_eventos') { r.id = load().sdb_eventos.length + 1; r.created_at = new Date().toISOString(); }
  if (table === 'sdb_roleta') r.created_at = new Date().toISOString();
  if (table === 'sdb_disparos') { const t = load().sdb_disparos || []; r.id = (t.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1; r.criado_em = new Date().toISOString(); r.enviados = r.enviados || 0; r.falhas = r.falhas || 0; }
  if (table === 'sdb_disparo_envios' || table === 'sdb_contato_envios') r.enviado_em = new Date().toISOString();
  if (table === 'sdb_contatos') { r.id = r.id || crypto.randomUUID(); r.token = r.token || crypto.randomBytes(12).toString('hex'); r.created_at = new Date().toISOString(); r.email_optout = !!r.email_optout; r.wa_optout = !!r.wa_optout; }
  if (table === 'sdb_wa_avisos') { const t = load().sdb_wa_avisos || []; r.id = (t.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1; r.criado_em = new Date().toISOString(); }
  if (table === 'sdb_wa_aviso_envios') r.enviado_em = new Date().toISOString();
  if (table === 'sdb_wa_destinos') r.criado_em = new Date().toISOString();
  if (table === 'sdb_disparos') { r.publico = r.publico || 'leads'; }
  if (table === 'sdb_trilha') { r.id = (load().sdb_trilha || []).length + 1; r.created_at = new Date(Date.now() + Number(process.env.SDB_OFFSET_MS || 0)).toISOString(); }
  if (table === 'sdb_progresso') r.assistiu_em = r.assistiu_em || new Date().toISOString();
  return r;
}

const UNICOS = { sdb_leads: ['whatsapp', 'token'], sdb_eventos: ['chave'], sdb_wa_destinos: ['id'] };

const db = {
  select: async (table, query = '') => linhas(table, query),
  one: async (table, query) => linhas(table, `${query}&limit=1`)[0] || null,
  insert: async (table, row) => {
    if (Array.isArray(row)) { SEM_SALVAR = true; const out = []; try { for (const x of row) out.push(await db.insert(table, x)); } finally { SEM_SALVAR = false; save(); } return out[0]; }
    const d = load();
    d[table] = d[table] || [];
    const r = novoRegistro(table, row);
    if (table === 'sdb_roleta' && d[table].some(x => x.lead_id === r.lead_id && x.dia === r.dia)) throw erroDuplicado();
    if (table === 'sdb_disparo_envios' && d[table].some(x => x.lead_id === r.lead_id && x.disparo_id === r.disparo_id)) throw erroDuplicado();
    if (table === 'sdb_contato_envios' && d[table].some(x => x.contato_id === r.contato_id && x.disparo_id === r.disparo_id)) throw erroDuplicado();
    if (table === 'sdb_wa_aviso_envios' && d[table].some(x => x.aviso_id === r.aviso_id && x.destino_id === r.destino_id)) throw erroDuplicado();
    for (const col of UNICOS[table] || []) {
      if (r[col] != null && d[table].some(x => x[col] === r[col])) throw erroDuplicado();
    }
    d[table].push(r); if (!SEM_SALVAR) save();
    return { ...r };
  },
  upsert: async (table, row, onConflict) => {
    const d = load();
    const cols = onConflict.split(',');
    const atual = d[table].find(x => cols.every(c => String(x[c]) === String(row[c])));
    if (atual) { Object.assign(atual, row); save(); return { ...atual }; }
    return db.insert(table, row);
  },
  update: async (table, query, patch) => {
    const d = load();
    const q = parse(query);
    const alvo = (d[table] || []).filter(r => casa(r, q.filtros));
    alvo.forEach(r => Object.assign(r, patch));
    save();
    return alvo.map(r => ({ ...r }));
  },
  enc: encodeURIComponent,
};

module.exports = { db, reset, load, save, ARQ };
