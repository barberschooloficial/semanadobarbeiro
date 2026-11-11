// POST /api/entrar — recupera o acesso ao app com WhatsApp + e-mail do cadastro
const { db } = require('./_lib/db');
const { readJson, send, handler, fail } = require('./_lib/http');
const { normalizaWhats, normalizaEmail } = require('./_lib/valida');

module.exports = handler(['POST'], async (req, res) => {
  const b = await readJson(req);
  const whatsapp = normalizaWhats(b.whatsapp);
  const email = normalizaEmail(b.email);
  if (!whatsapp || !email) throw fail(400, 'Confira o WhatsApp e o e-mail.');
  const lead = await db.one('sdb_leads', `whatsapp=eq.${whatsapp}&select=token,email`);
  if (!lead || lead.email !== email) throw fail(404, 'Não encontramos um cadastro com esses dados.');
  send(res, 200, { ok: true, token: lead.token });
});
