// POST /api/progresso — marca uma aula liberada como assistida
const { db, config, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, bearer, handler, fail } = require('./_lib/http');
const manychat = require('./_lib/manychat');
const { comTimeout, agora } = require('./_lib/util');
const { turmaDo, janela } = require('./_lib/turma');

module.exports = handler(['POST'], async (req, res) => {
  const lead = await leadByToken(bearer(req));
  if (!lead) throw fail(401, 'Acesso não encontrado.');
  const b = await readJson(req);
  const aulaId = Number(b.aula_id);
  if (!Number.isInteger(aulaId)) throw fail(400, 'Aula inválida.');

  const aula = await db.one('sdb_aulas', `id=eq.${aulaId}&ativo=eq.true&select=id,ordem,dia`);
  const cfg = await config();
  const j = janela(turmaDo(lead, cfg), cfg);
  if (!aula || agora() < j.libera(aula.dia)) throw fail(400, 'Esta aula ainda não foi liberada.');
  if (agora() > j.fim && lead.curso_status !== 'pago') throw fail(400, 'A sua Semana do Barbeiro terminou.');

  await db.upsert('sdb_progresso', { lead_id: lead.id, aula_id: aulaId }, 'lead_id,aula_id');
  const novo = await logEvento('aula_assistida', { lead_id: lead.id, chave: `aula:${lead.id}:${aulaId}`, payload: { ordem: aula.ordem } });
  // Tag por dia: permite lembrar no WhatsApp só quem ainda não assistiu (ex.: sdb_assistiu_d1)
  if (novo) await comTimeout(manychat.sync(lead, { tags: [`sdb_assistiu_d${aula.dia}`] }), 3000);
  send(res, 200, { ok: true });
});
