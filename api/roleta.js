// POST /api/roleta — gira a roleta do módulo (uma vez por módulo). Libera as aulas daquele dia.
const { db, config, leadByToken, logEvento } = require('./_lib/db');
const { readJson, send, bearer, handler, fail } = require('./_lib/http');
const { premio, sortear } = require('./_lib/premios');
const manychat = require('./_lib/manychat');
const { comTimeout, agora } = require('./_lib/util');
const { turmaDo, janela } = require('./_lib/turma');

async function liberarBarbeearia(lead) {
  // Libera o e-mail na Barbeearia (rota /api/acesso do sistema), se estiver configurado
  const url = process.env.BARBEEARIA_ACESSO_URL, segredo = process.env.BARBEEARIA_ACESSO_SECRET;
  if (!url || !segredo) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${segredo}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lead.email, status: 'ativo', origem: 'semana-do-barbeiro-roleta-30dias', referencia: `roleta:${lead.id}` }),
    });
  } catch (e) { console.error('barbeearia acesso', e.message); }
}

module.exports = handler(['POST'], async (req, res) => {
  const lead = await leadByToken(bearer(req));
  if (!lead) throw fail(401, 'Acesso não encontrado.');
  const b = await readJson(req);
  const dia = Number(b.dia);
  if (!Number.isInteger(dia) || dia < 1 || dia > 7) throw fail(400, 'Módulo inválido.');

  const cfg = await config();
  const ja = await db.one('sdb_roleta', `lead_id=eq.${lead.id}&dia=eq.${dia}&select=*`);
  if (ja) return send(res, 200, { ok: true, dia, fatia: ja.fatia, premio: premio(ja.premio, cfg), repetido: true });

  const aulas = await db.select('sdb_aulas', `dia=eq.${dia}&ativo=eq.true&select=id`);
  const t = agora();
  const j = janela(turmaDo(lead, cfg), cfg);
  if (!aulas.length || t < j.libera(dia)) throw fail(400, 'A roleta deste módulo ainda não abriu.');
  if (t > j.fim && lead.curso_status !== 'pago') throw fail(400, 'A Semana do Barbeiro terminou.');

  const s = sortear(dia);
  try {
    await db.insert('sdb_roleta', { lead_id: lead.id, dia, premio: s.codigo, fatia: s.fatia });
  } catch (e) {
    if (e.code !== '23505') throw e; // girou em duas abas ao mesmo tempo: vale o primeiro
    const r = await db.one('sdb_roleta', `lead_id=eq.${lead.id}&dia=eq.${dia}&select=*`);
    return send(res, 200, { ok: true, dia, fatia: r.fatia, premio: premio(r.premio, cfg), repetido: true });
  }
  await logEvento('roleta', { lead_id: lead.id, chave: `roleta:${lead.id}:${dia}`, payload: { dia, premio: s.codigo } });
  if (s.codigo === 'barbeearia') await comTimeout(liberarBarbeearia(lead), 3000);
  await comTimeout(manychat.sync(lead, { tags: [`sdb_roleta_${s.codigo}`] }), 3000);

  send(res, 200, { ok: true, dia, fatia: s.fatia, premio: premio(s.codigo, cfg) });
});
