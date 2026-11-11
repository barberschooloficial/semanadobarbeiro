// Acesso ao Supabase via REST (PostgREST) com a service_role key — só no servidor.
const REST = process.env.SUPABASE_REST_URL || `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function req(path, { method = 'GET', body, prefer } = {}) {
  if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${REST}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const err = new Error(data?.message || `Supabase ${r.status}`);
    err.status = r.status; err.code = data?.code; err.details = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

const LOCAL = process.env.SDB_LOCAL === '1';

const db = LOCAL ? require('./db-local').db : {
  select: (table, query = '') => req(`${table}?${query}`),
  one: async (table, query) => (await req(`${table}?${query}&limit=1`))[0] || null,
  insert: (table, row) => req(table, { method: 'POST', body: row, prefer: 'return=representation' }).then(r => r[0]),
  upsert: (table, row, onConflict) =>
    req(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' }).then(r => r[0]),
  update: (table, query, patch) => req(`${table}?${query}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  enc,
};

// Config (tabela sdb_config) com cache curto
let cfgCache = null, cfgAt = 0;
async function config() {
  if (!LOCAL && cfgCache && Date.now() - cfgAt < 30_000) return cfgCache;
  const rows = await db.select('sdb_config', 'select=chave,valor');
  cfgCache = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
  cfgAt = Date.now();
  return cfgCache;
}

config.limpar = () => { cfgCache = null; };

async function leadByToken(token) {
  if (!token || !/^[a-f0-9]{20,64}$/.test(token)) return null;
  return db.one('sdb_leads', `token=eq.${enc(token)}&select=*`);
}

async function logEvento(tipo, { lead_id = null, chave = null, payload = null } = {}) {
  try {
    await db.insert('sdb_eventos', { tipo, lead_id, chave, payload });
    return true;
  } catch (e) {
    if (e.code === '23505') return false; // evento já processado (idempotência)
    console.error('logEvento', e.message);
    return true;
  }
}

module.exports = { db, config, leadByToken, logEvento };
