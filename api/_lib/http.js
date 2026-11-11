// Helpers HTTP para as funções da Vercel (Node, sem framework)
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    // Hotmart/Asaas sempre mandam JSON; form-urlencoded como fallback
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function handler(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { erro: 'Método não permitido' });
    try {
      await fn(req, res);
    } catch (e) {
      if (!e.publicMessage || (e.httpStatus || 500) >= 500) console.error(e);
      send(res, e.httpStatus || 500, { erro: e.publicMessage || 'Erro interno. Tente de novo em instantes.' });
    }
  };
}

function fail(status, msg) {
  const e = new Error(msg); e.httpStatus = status; e.publicMessage = msg; return e;
}

const SITE_URL = () => (process.env.SITE_URL || 'https://semanadobarbeiro.com.br').replace(/\/$/, '');
const APP_URL = () => (process.env.APP_URL || 'https://app.semanadobarbeiro.com.br').replace(/\/$/, '');

module.exports = { readJson, send, bearer, handler, fail, SITE_URL, APP_URL };
