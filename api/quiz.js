// POST /api/quiz — quiz de validação pós-cadastro (define o perfil do lead)
const { db, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, handler, fail } = require('./_lib/http');
const manychat = require('./_lib/manychat');
const { comTimeout } = require('./_lib/util');

// Respostas aceitas (iguais às opções da página /quiz)
const PERGUNTAS = Object.fromEntries(require('./_lib/quiz-def').PERGUNTAS.map(q => [q.k, q.o.map(([v]) => v)]));

function perfilDe(r) {
  if (r.experiencia === 'tenho_barbearia' || r.experiencia === 'trabalho_barbearia') return 'profissional';
  if (r.experiencia === 'corto_amigos') return 'ja_corta';
  return 'iniciante';
}

module.exports = handler(['POST'], async (req, res) => {
  const b = await readJson(req);
  const lead = await leadByToken(b.token);
  if (!lead) throw fail(401, 'Cadastro não encontrado. Faça o cadastro de novo.');

  const r = {};
  for (const [k, opcoes] of Object.entries(PERGUNTAS)) {
    if (!opcoes.includes(b.respostas?.[k])) throw fail(400, 'Responda todas as perguntas.');
    r[k] = b.respostas[k];
  }
  const perfil = perfilDe(r);
  await db.update('sdb_leads', `id=eq.${lead.id}`, { quiz: r, perfil, quiz_at: new Date().toISOString() });
  await comTimeout(manychat.sync(lead, { tags: ['sdb_quiz', `sdb_perfil_${perfil}`], campos: { perfil } }), 4000);
  await logEvento('quiz', { lead_id: lead.id, payload: { perfil } });

  send(res, 200, { ok: true, perfil });
});
