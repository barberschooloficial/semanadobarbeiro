// Senha do painel (ADMIN_KEY) comparada em tempo constante
const crypto = require('crypto');

function adminOk(req) {
  const esperado = process.env.ADMIN_KEY || '';
  const recebido = String(req.headers['x-admin-key'] || '');
  return esperado.length >= 8 && esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

// Chamada do agendador (pg_cron do Supabase): CRON_SECRET no header x-cron-key, ou a própria senha do painel
function cronOk(req) {
  const esperado = process.env.CRON_SECRET || '';
  const recebido = String(req.headers['x-cron-key'] || '');
  if (esperado.length >= 16 && esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))) return true;
  const senha = process.env.ADMIN_KEY || '';
  if (senha.length >= 8 && senha.length === recebido.length && crypto.timingSafeEqual(Buffer.from(senha), Buffer.from(recebido))) return true;
  return adminOk(req);
}

module.exports = { adminOk, cronOk };
