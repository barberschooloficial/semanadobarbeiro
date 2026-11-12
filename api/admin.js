// GET /api/admin — painel (protegido pela senha ADMIN_KEY)
//   ?ver=resumo (padrão) → funil, aulas, origem, cadastros por dia
//   ?ver=enquete         → respostas do quiz agrupadas para os gráficos
//   ?ver=alunos          → lista de cadastros (para filtrar e exportar os disparos)
//   ?ver=aluno&id=<uuid> → ficha completa de um aluno
const crypto = require('crypto');
const { db } = require('./_lib/db');
const { send, handler, fail } = require('./_lib/http');
const { PERGUNTAS, PERFIS } = require('./_lib/quiz-def');
const { premio } = require('./_lib/premios');
const { config, CHAVE_ERRADA } = require('./_lib/db');
const { turmaDo, segundaDa, em } = require('./_lib/turma');
const { agora } = require('./_lib/util');

const COLS = 'id,nome,whatsapp,email,perfil,quiz,quiz_at,origem,utm_source,utm_medium,utm_campaign,utm_content,cert_status,curso_status,barberhub_status,turma_inicio,last_seen_at,created_at';
const UUID = /^[0-9a-f-]{36}$/i;

// PostgREST devolve no máximo ~1000 linhas por chamada: pagina até trazer tudo
async function todos(table, query) {
  const out = [];
  for (let off = 0; off < 100000; off += 1000) {
    const rows = await db.select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const conta = (arr, f) => arr.reduce((m, x) => { const v = f(x) || '(vazio)'; m[v] = (m[v] || 0) + 1; return m; }, {});
const so = (o, cols) => Object.fromEntries(cols.split(',').map(c => [c, o[c] ?? null]));

module.exports = handler(['GET'], async (req, res) => {
  const esperado = process.env.ADMIN_KEY || '';
  const recebido = String(req.headers['x-admin-key'] || '');
  if (esperado.length < 8 || esperado.length !== recebido.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))) {
    return send(res, 401, { erro: 'Senha inválida' });
  }
  if (CHAVE_ERRADA) return send(res, 500, { erro: CHAVE_ERRADA });
  const u = new URL(req.url, 'http://x');
  const ver = u.searchParams.get('ver') || 'resumo';

  if (ver === 'resumo') {
    const cfg = await config();
    const turma = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('turma') || '') ? u.searchParams.get('turma') : '';
    const campanha = (u.searchParams.get('campanha') || '').slice(0, 100);
    const [leadsTodos, prog, trilha, aulas] = await Promise.all([
      todos('sdb_leads', 'select=id,perfil,turma_inicio,utm_source,utm_medium,utm_campaign,quiz_at,last_seen_at,cert_status,cert_valor,curso_status,barberhub_status,created_at&order=created_at.asc'),
      todos('sdb_progresso', 'select=lead_id,aula_id'),
      todos('sdb_trilha', 'select=sessao,lead_id,tipo,pagina,utm_source,utm_campaign,created_at&tipo=in.(visita,oferta_vista,checkout_clique)&order=id.asc'),
      db.select('sdb_aulas', 'select=id,ordem,titulo&ativo=eq.true&order=ordem.asc'),
    ]);
    const camp = (x) => x.utm_campaign || (x.utm_source ? `(${x.utm_source} sem campanha)` : '(direto / orgânico)');
    leadsTodos.forEach(l => { l.turma = turmaDo(l, cfg); l.camp = camp(l); });
    const leads = leadsTodos.filter(l => (!turma || l.turma === turma) && (!campanha || l.camp === campanha));
    const ids = new Set(leads.map(l => l.id));
    const nAulas = {}; prog.forEach(p => { nAulas[p.lead_id] = (nAulas[p.lead_id] || 0) + 1; });
    // Visitas do site: sessões únicas; com turma, conta as visitas do período de captação dela (quinta anterior a quarta)
    const capIni = turma ? em(turma, -4) : 0, capFim = turma ? em(turma, 3) : Infinity;
    const visitas = trilha.filter(t => t.tipo === 'visita' && String(t.pagina || '').startsWith('site/') && (!campanha || camp(t) === campanha)
      && Date.parse(t.created_at) >= capIni && Date.parse(t.created_at) < capFim);
    const sess = (arr) => new Set(arr.map(t => t.sessao)).size;
    const leadsCom = (tipo) => new Set(trilha.filter(t => t.tipo === tipo && ids.has(t.lead_id)).map(t => t.lead_id)).size;
    const total = aulas.length || 10;
    const n = (f) => leads.filter(f).length;
    const etapas = [
      ['Visitaram o site', sess(visitas)],
      ['Cadastraram', leads.length],
      ['Responderam a enquete', n(l => l.quiz_at)],
      ['Abriram o app', n(l => l.last_seen_at)],
      ['Assistiram 1+ aula', n(l => nAulas[l.id] > 0)],
      ['Assistiram as 10 aulas', n(l => nAulas[l.id] >= total)],
      ['Viram a oferta', leadsCom('oferta_vista')],
      ['Clicaram em comprar', leadsCom('checkout_clique')],
      ['Compraram o curso', n(l => l.curso_status === 'pago')],
    ].map(([nome, v]) => ({ nome, v }));
    const preco = { cert: Number(cfg.cert_preco || 19.7), curso: Number(cfg.curso_preco_por || 147), hub: Number(cfg.barberhub_preco || 0) };
    const receitaDe = (L) => L.filter(l => l.cert_status === 'pago').reduce((s, l) => s + (Number(l.cert_valor) || preco.cert), 0) + L.filter(l => l.curso_status === 'pago').length * preco.curso + L.filter(l => l.barberhub_status === 'pago').length * preco.hub;
    // Campanhas (sempre dentro do filtro de turma)
    const baseTurma = leadsTodos.filter(l => !turma || l.turma === turma);
    const vTurma = trilha.filter(t => t.tipo === 'visita' && String(t.pagina || '').startsWith('site/') && Date.parse(t.created_at) >= capIni && Date.parse(t.created_at) < capFim);
    const nomes = new Set([...baseTurma.map(l => l.camp), ...vTurma.map(camp)]);
    const campanhas = [...nomes].map(c => {
      const L = baseTurma.filter(l => l.camp === c);
      return {
        campanha: c, visitas: sess(vTurma.filter(t => camp(t) === c)), cadastros: L.length,
        assistiram: L.filter(l => nAulas[l.id] > 0).length, certificados: L.filter(l => l.cert_status === 'pago').length,
        cursos: L.filter(l => l.curso_status === 'pago').length, barbeearia: L.filter(l => l.barberhub_status === 'pago').length, receita: receitaDe(L),
      };
    }).sort((a, b) => b.cadastros - a.cadastros || b.visitas - a.visitas);
    const turmas = [...new Set(leadsTodos.map(l => l.turma))].sort().reverse().map(t => {
      const L = leadsTodos.filter(l => l.turma === t);
      return { turma: t, cadastros: L.length, assistiram: L.filter(l => nAulas[l.id] > 0).length, cursos: L.filter(l => l.curso_status === 'pago').length, receita: receitaDe(L) };
    });
    const vistosPorAula = {}; prog.filter(p => ids.has(p.lead_id)).forEach(p => { vistosPorAula[p.aula_id] = (vistosPorAula[p.aula_id] || 0) + 1; });
    return send(res, 200, {
      filtro: { turma, campanha }, turma_atual: segundaDa(agora()),
      etapas,
      extras: { certificados: n(l => l.cert_status === 'pago'), barbeearia: n(l => l.barberhub_status === 'pago'), receita: receitaDe(leads) },
      campanhas, turmas, lista_campanhas: [...new Set(leadsTodos.map(l => l.camp))].sort(),
      aulas: aulas.map(a => ({ ordem: a.ordem, titulo: a.titulo, assistiram: vistosPorAula[a.id] || 0 })),
      por_origem: conta(leads, l => l.utm_source),
      por_perfil: conta(leads, l => PERFIS[l.perfil] || l.perfil),
      cadastros_por_dia: conta(leads, l => new Date(l.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })),
    });
  }

  if (ver === 'enquete') {
    const leads = await todos('sdb_leads', 'select=quiz,perfil,utm_source,quiz_at&order=created_at.desc');
    const resp = leads.filter(l => l.quiz_at && l.quiz);
    return send(res, 200, {
      cadastros: leads.length,
      responderam: resp.length,
      perguntas: [
        { k: 'perfil', p: 'Perfil (calculado pelo quiz)', o: Object.entries(PERFIS).map(([v, t]) => ({ v, t, n: resp.filter(l => l.perfil === v).length })) },
        ...PERGUNTAS.map(q => ({ k: q.k, p: q.p, o: q.o.map(([v, t]) => ({ v, t, n: resp.filter(l => l.quiz[q.k] === v).length })) })),
      ],
      origem: conta(leads, l => l.utm_source),
    });
  }

  if (ver === 'alunos') {
    const cfgA = await config();
    const [leads, prog, roleta] = await Promise.all([
      todos('sdb_leads', `select=${COLS}&order=created_at.desc`),
      todos('sdb_progresso', 'select=lead_id,aula_id'),
      todos('sdb_roleta', 'select=lead_id,dia,premio'),
    ]);
    const aulas = conta(prog, p => p.lead_id);
    const giros = conta(roleta, r => r.lead_id);
    return send(res, 200, {
      perguntas: PERGUNTAS.map(q => ({ k: q.k, p: q.p, o: Object.fromEntries(q.o) })),
      perfis: PERFIS,
      alunos: leads.map(l => ({ ...so(l, COLS), turma: turmaDo(l, cfgA), aulas: aulas[l.id] || 0, giros: giros[l.id] || 0 })),
    });
  }

  if (ver === 'aluno') {
    const id = u.searchParams.get('id') || '';
    if (!UUID.test(id)) throw fail(400, 'Aluno inválido');
    const lead = await db.one('sdb_leads', `select=*&id=eq.${id}`);
    if (!lead) throw fail(404, 'Aluno não encontrado');
    const [aulas, prog, roleta, eventos, trilha, cfgRows] = await Promise.all([
      db.select('sdb_aulas', 'select=id,ordem,dia,titulo&order=ordem.asc'),
      db.select('sdb_progresso', `select=aula_id,assistiu_em&lead_id=eq.${id}`),
      db.select('sdb_roleta', `select=dia,premio,created_at&lead_id=eq.${id}&order=dia.asc`),
      db.select('sdb_eventos', `select=tipo,created_at&lead_id=eq.${id}&order=created_at.desc&limit=60`),
      db.select('sdb_trilha', `select=tipo,pagina,detalhe,utm_campaign,created_at&lead_id=eq.${id}&order=id.desc&limit=80`),
      db.select('sdb_config', 'select=chave,valor'),
    ]);
    const cfg = Object.fromEntries(cfgRows.map(r => [r.chave, r.valor]));
    const visto = Object.fromEntries(prog.map(p => [p.aula_id, p.assistiu_em]));
    const dados = so(lead, COLS + ',cert_paid_at,cert_forma,cert_valor,cert_criado_em,cert_expira_em,curso_paid_at,barberhub_paid_at,lgpd_consent,manychat_id');
    dados.cpf = lead.cpf ? `***.${String(lead.cpf).slice(3, 6)}.***-${String(lead.cpf).slice(-2)}` : null;
    return send(res, 200, {
      aluno: dados,
      quiz: lead.quiz ? PERGUNTAS.map(q => ({ p: q.p, r: Object.fromEntries(q.o)[lead.quiz[q.k]] || lead.quiz[q.k] || '—' })) : null,
      perfil: PERFIS[lead.perfil] || lead.perfil || null,
      aulas: aulas.map(a => ({ ordem: a.ordem, dia: a.dia, titulo: a.titulo, assistiu_em: visto[a.id] || null })),
      roleta: roleta.map(r => ({ dia: r.dia, premio: premio(r.premio, cfg)?.titulo || r.premio, em: r.created_at })),
      eventos, trilha, turma: turmaDo(lead, cfg),
    });
  }

  throw fail(400, 'Visão inválida');
});
