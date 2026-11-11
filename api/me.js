// GET /api/me — tudo que o app precisa: aulas liberadas/bloqueadas, progresso, oferta e status
const { db, config, leadByToken } = require('./_lib/db');
const { send, bearer, handler, fail } = require('./_lib/http');
const { primeiroNome } = require('./_lib/valida');
const { agora: relogio } = require('./_lib/util');
const { premio } = require('./_lib/premios');
const { turmaDo, janela, textoLives } = require('./_lib/turma');

module.exports = handler(['GET'], async (req, res) => {
  const lead = await leadByToken(bearer(req));
  if (!lead) throw fail(401, 'Acesso não encontrado.');

  const [cfg, aulas, prog, giros] = await Promise.all([
    config(),
    db.select('sdb_aulas', 'ativo=eq.true&select=id,ordem,dia,titulo,descricao,youtube_id,duracao_min,libera_em&order=ordem.asc'),
    db.select('sdb_progresso', `lead_id=eq.${lead.id}&select=aula_id`),
    db.select('sdb_roleta', `lead_id=eq.${lead.id}&select=dia,premio,fatia&order=dia.asc`),
  ]);
  const roleta = Object.fromEntries(giros.map(g => [g.dia, { fatia: g.fatia, premio: premio(g.premio, cfg) }]));
  const agora = relogio();
  const j = janela(turmaDo(lead, cfg), cfg);
  const expirou = agora > j.fim;
  const comprou = lead.curso_status === 'pago';
  const vistas = new Set(prog.map(p => p.aula_id));

  const lista = aulas.map(a => {
    const libera = j.libera(a.dia);
    const liberada = agora >= libera && (!expirou || comprou);
    return {
      id: a.id, ordem: a.ordem, dia: a.dia, titulo: a.titulo, descricao: a.descricao,
      duracao_min: a.duracao_min, libera_em: new Date(libera).toISOString(), liberada,
      youtube_id: liberada ? a.youtube_id : null,   // vídeo bloqueado nunca sai do servidor
      assistida: vistas.has(a.id),
    };
  });

  const abre = j.ofertaAbre, fecha = j.fim;
  const proximaLive = j.lives.find(l => l.fim > agora);
  // A oferta aparece no 5º dia, depois que a pessoa gira a roleta do módulo 5
  const ofertaAberta = agora >= abre && agora <= fecha && !!roleta[5];
  const sck = `sdb_${lead.id}`;
  const checkout = (() => {
    try {
      const u = new URL(cfg.hotmart_checkout_url);
      u.searchParams.set('name', lead.nome);
      u.searchParams.set('email', lead.email);
      u.searchParams.set('sck', sck);
      if (roleta[4]?.premio?.cupom) u.searchParams.set('offDiscount', roleta[4].premio.cupom); // cupom do 4º dia já aplicado
      return u.toString();
    } catch { return null; }
  })();

  const total = lista.length, assistidas = lista.filter(a => a.assistida).length;

  await db.update('sdb_leads', `id=eq.${lead.id}`, { last_seen_at: new Date().toISOString() }).catch(() => {});

  send(res, 200, {
    aluno: { nome: lead.nome, primeiro_nome: primeiroNome(lead.nome), perfil: lead.perfil, quiz_ok: !!lead.quiz_at },
    aulas: lista,
    roleta,
    progresso: { total, assistidas },
    expirou: !!expirou,
    agora: new Date(agora).toISOString(),
    oferta: {
      abre_em: new Date(abre).toISOString(), fecha_em: new Date(fecha).toISOString(),
      aberta: ofertaAberta, preco_de: cfg.curso_preco_de, preco_por: cfg.curso_preco_por,
      parcelas: cfg.curso_parcelas, checkout: ofertaAberta ? checkout : null,
    },
    certificado: {
      status: lead.cert_status, preco: cfg.cert_preco,
      invoice_url: lead.cert_status === 'pendente' ? lead.cert_invoice_url : null,
      liberado: lead.cert_status === 'pago' && assistidas >= total && total > 0,
    },
    curso: { status: lead.curso_status },
    barberhub: { status: lead.barberhub_status, preco: cfg.barberhub_preco, ciclo: cfg.barberhub_ciclo, invoice_url: lead.barberhub_status === 'pendente' ? lead.barberhub_invoice_url : null },
    turma: { inicio: j.turma, fim: new Date(j.fim).toISOString() },
    live: {
      url: cfg.live_url, horario: textoLives(cfg),
      proxima: proximaLive ? { inicio: new Date(proximaLive.inicio).toISOString(), fim: new Date(proximaLive.fim).toISOString(), ao_vivo: agora >= proximaLive.inicio } : null,
    },
    grupo_whatsapp_url: cfg.grupo_whatsapp_url || null,
  });
});
