// /api/disparos — disparos de e-mail (Resend) e WhatsApp (ManyChat) com fila e agendamento.
// Grupos do WhatsApp:    ?acao=wa_* (ver _lib/grupos.js; a extensão usa x-ext-key)
// Painel (x-admin-key):  GET ?acao=lista · POST ?acao=contar|criar|semana|cancelar|teste|processar
// Agendador:            GET/POST ?acao=tick (pg_cron do Supabase a cada 5 min, sem senha, com trava de 4 min)
//                        POST ?acao=processar com x-cron-key também funciona
// Público:               GET/POST ?acao=descadastro&t=<token>  (link "não quero mais receber")
const { db, config, logEvento } = require('./_lib/db');
const { readJson, send, handler, fail, SITE_URL, APP_URL } = require('./_lib/http');
const { adminOk, cronOk } = require('./_lib/admin-auth');
const { carregar, filtrar, aptos, descrever, SITUACOES } = require('./_lib/publico');
const { enviarLote, preencher, layout, corpoHtml } = require('./_lib/email');
const { enviarFluxo, garantirContato } = require('./_lib/manychat');
const C = require('./_lib/contatos');
const { normalizaWhats, normalizaEmail } = require('./_lib/valida');
const { COPIES, dataDe, ajustar } = require('./_lib/copies');
const { COPIES_GRUPO } = require('./_lib/copies-grupo');
const { PERGUNTAS, PERFIS } = require('./_lib/quiz-def');
const { agora } = require('./_lib/util');
const { segundaDa, em, ymd, rotulo, DIA } = require('./_lib/turma');
const G = require('./_lib/grupos');

// Configurações que o painel pode alterar (aba Configurações). Segredos não entram aqui.
const CAMPOS_CFG = [
  { titulo: 'Atendimento', campos: [
    { chave: 'whatsapp_suporte', rotulo: 'WhatsApp do suporte', tipo: 'fone', ajuda: 'Número que abre nos botões de WhatsApp do site e do app. Se a Meta bloquear o número, troque aqui: vale em até 1 minuto.' },
    { chave: 'grupo_whatsapp_url', rotulo: 'Link do grupo ou canal de avisos', tipo: 'url', opcional: true, ajuda: 'Aparece no app como "Entrar no grupo de avisos". Vazio esconde o botão.' },
    { chave: 'live_url', rotulo: 'Onde acontece a live', tipo: 'url' },
  ] },
  { titulo: 'Curso e oferta', campos: [
    { chave: 'hotmart_checkout_url', rotulo: 'Link do checkout da Hotmart (oferta)', tipo: 'url', ajuda: 'Link da oferta com o código (?off=...). Nome, e-mail e o cupom da roleta são acrescentados sozinhos.' },
    { chave: 'curso_preco_de', rotulo: 'Preço cheio (R$)', tipo: 'num' },
    { chave: 'curso_preco_por', rotulo: 'Preço da oferta (R$)', tipo: 'num' },
    { chave: 'curso_parcelas', rotulo: 'Texto do parcelamento', tipo: 'texto' },
    { chave: 'curso_site_url', rotulo: 'Site do curso', tipo: 'url', ajuda: 'Para onde vai quem já fez uma Semana e tenta se cadastrar de novo.' },
  ] },
  { titulo: 'Certificado e Barbeearia', campos: [
    { chave: 'cert_preco', rotulo: 'Preço do certificado (R$)', tipo: 'num' },
    { chave: 'barberhub_preco', rotulo: 'Preço da Barbeearia no app (R$)', tipo: 'num' },
    { chave: 'barberhub_ciclo', rotulo: 'Cobrança da Barbeearia', tipo: 'sel', opcoes: [['MONTHLY', 'Assinatura mensal'], ['UNICO', 'Pagamento único']] },
    { chave: 'barbeearia_convite_url', rotulo: 'Link do convite de 30 dias da Barbeearia', tipo: 'url' },
  ] },
  { titulo: 'Prêmios da roleta', campos: [
    { chave: 'premio_barbeearia_url', rotulo: 'Dia 1: link dos 30 dias da Barbeearia', tipo: 'url' },
    { chave: 'premio_clube_url', rotulo: 'Dia 3: link do Clube do Barbeiro', tipo: 'url' },
    { chave: 'premio_vitalicio_cupom', rotulo: 'Dia 4: cupom do curso vitalício', tipo: 'texto', ajuda: 'O cupom precisa existir na Hotmart.' },
  ] },
  { titulo: 'Turma e lives', campos: [
    { chave: 'aula_hora', rotulo: 'Hora em que o módulo abre', tipo: 'hora' },
    { chave: 'live_dias', rotulo: 'Dias das lives', tipo: 'dias', ajuda: '1 = segunda ... 7 = domingo. Ex.: 1,5' },
    { chave: 'live_inicio', rotulo: 'Início da live', tipo: 'hora' },
    { chave: 'live_fim', rotulo: 'Fim da live', tipo: 'hora' },
  ] },
  { titulo: 'Automação', campos: [
    { chave: 'disparos_auto', rotulo: 'Programar sozinho os e-mails e WhatsApps de cada turma', tipo: 'bool' },
    { chave: 'grupos_auto', rotulo: 'Programar sozinho os avisos nos grupos', tipo: 'bool' },
    { chave: 'wa_limite_dia', rotulo: 'Máximo de avisos por grupo por dia', tipo: 'int' },
    { chave: 'wa_intervalo_min', rotulo: 'Extensão: espera mínima entre grupos (segundos)', tipo: 'int' },
    { chave: 'wa_intervalo_max', rotulo: 'Extensão: espera máxima entre grupos (segundos)', tipo: 'int' },
  ] },
];

const TOKEN = /^[a-f0-9]{20,64}$/;
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const varsDe = (l) => ({ nome: String(l.nome || '').split(' ')[0], app_link: `${APP_URL()}/?t=${l.token}` });
// Variáveis de um contato de lista: o link passa pelo /api/t (marca o clique) e segue para a Semana ou para a Barbeearia
const slug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
function varsContato(c, d, ch) {
  const link = `${SITE_URL()}/api/t?r=${c.token}&d=${d.id}&ch=${ch}`;
  return { nome: String(c.nome || '').split(' ')[0] || 'barbeiro', link, app_link: link, cidade: c.cidade || '' };
}
const linkSair = (l) => `${SITE_URL()}/api/disparos?acao=descadastro&t=${l.token}`;

function limpaFiltro(f = {}) {
  const out = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.turma || '')) out.turma = f.turma;
  if (f.perfil && PERFIS[f.perfil]) out.perfil = f.perfil;
  if (f.sit && SITUACOES[f.sit] !== undefined) out.sit = f.sit;
  if (f.resp?.k && PERGUNTAS.some(q => q.k === f.resp.k)) out.resp = { k: f.resp.k, v: String(f.resp.v || ''), t: String(f.resp.t || '').slice(0, 80) };
  if (f.sem_curso) out.sem_curso = true;
  if (Number(f.dia_sem_aula) >= 1 && Number(f.dia_sem_aula) <= 7) out.dia_sem_aula = Number(f.dia_sem_aula);
  return out;
}

const REGIOES_OK = ['Sudeste', 'Sul', 'Nordeste', 'Centro-Oeste', 'Norte'];
function limpaFiltroC(f = {}) {
  const out = {};
  const t = (v, n = 60) => String(v || '').trim().slice(0, n);
  if (t(f.lista)) out.lista = t(f.lista);
  if (REGIOES_OK.includes(f.regiao)) out.regiao = f.regiao;
  if (/^[A-Z]{2}$/.test(f.uf || '')) out.uf = f.uf;
  if (t(f.cidade)) out.cidade = t(f.cidade);
  if (PERFIS[f.perfil]) out.perfil = f.perfil;
  if (t(f.bloco, 80)) out.bloco = t(f.bloco, 80);
  if (C.ENGAJAMENTO[f.eng] !== undefined && f.eng) out.eng = f.eng;
  return out;
}

// ---------- processamento da fila ----------
// Turma em foco: a da semana atual até sexta 20h; depois disso, a da próxima segunda
function turmaAlvo() {
  const t = agora(), atual = segundaDa(t);
  return t < em(atual, 4, '20:00') ? atual : segundaDa(t + 4 * DIA);
}
function turmasRecentes() {
  const atual = segundaDa(agora());
  return [-21, -14, -7, 0, 7].map(d => ymd(Date.parse(`${atual}T12:00:00-03:00`) + d * DIA));
}

// Cria (uma vez só) os disparos da biblioteca para uma turma. Ignora horários que já passaram.
async function garantirCalendario(turma, cfg, folgaMs = 10 * 60e3) {
  const ja = new Set((await db.select('sdb_disparos', `select=copy_id,agendar_em&status=neq.cancelado&agendar_em=gte.${encodeURIComponent(new Date(em(turma, -2)).toISOString())}&limit=1000`))
    .map(d => `${d.copy_id}|${new Date(d.agendar_em).toISOString()}`));
  const criados = [], pulados = [];
  for (const c of ajustar(COPIES, cfg).filter(c => c.quando)) {
    const quando = dataDe(turma, c.quando);
    if (ja.has(`${c.id}|${quando}`)) { pulados.push({ titulo: c.titulo, motivo: 'já programado' }); continue; }
    if (Date.parse(quando) < agora() - folgaMs) { pulados.push({ titulo: c.titulo, motivo: 'horário já passou' }); continue; }
    const flow_ns = c.flow_cfg ? cfg[c.flow_cfg] : null;
    if (c.canal === 'whatsapp' && !flow_ns) { pulados.push({ titulo: c.titulo, motivo: `preencha ${c.flow_cfg} em sdb_config` }); continue; }
    await db.insert('sdb_disparos', {
      canal: c.canal, titulo: `${c.titulo} · turma ${rotulo(turma)}`, copy_id: c.id, filtro: { ...(c.filtro || {}), turma },
      assunto: c.assunto || null, texto: c.texto || null, flow_ns,
      agendar_em: quando, status: 'agendado', total: 0, enviados: 0, falhas: 0,
    });
    criados.push(c.titulo);
  }
  return { criados, pulados };
}

async function processar(limiteMs = 40000) {
  // Automático: garante o calendário da turma atual e da próxima (véspera de domingo)
  const cfg0 = await config();
  if (cfg0.disparos_auto !== '0') {
    const atual = segundaDa(agora());
    for (const t of [atual, ymd(Date.parse(`${atual}T12:00:00-03:00`) + 7 * DIA)]) await garantirCalendario(t, cfg0).catch(e => console.error('calendario', e.message));
  }
  if (cfg0.grupos_auto !== '0') await G.garantirCalendario(segundaDa(agora())).catch(e => console.error('grupos', e.message));
  await require('./_lib/boasvindas').pendentes().catch(e => console.error('boas-vindas', e.message));
  const t0 = Date.now();
  const resumo = [];
  const agoraIso = new Date(agora()).toISOString();
  await G.cfgSet('disparos_ultimo', agoraIso); // o painel mostra quando a fila rodou pela última vez
  const fila = await db.select('sdb_disparos', `select=*&status=in.(agendado,enviando)&agendar_em=lte.${encodeURIComponent(agoraIso)}&order=agendar_em.asc&limit=10`);
  if (!fila.length) return resumo;
  let base = null, baseC = null;

  for (const d of fila) {
    if (Date.now() - t0 > limiteMs) break;
    const ehC = d.publico === 'contatos';
    const T_ENV = ehC ? 'sdb_contato_envios' : 'sdb_disparo_envios', COL = ehC ? 'contato_id' : 'lead_id';
    // PostgREST devolve no máximo 1000 linhas por chamada: pagina para não reenviar a ninguém
    const feitos = new Set();
    for (let off = 0; ; off += 1000) {
      const rows = await db.select(T_ENV, `select=${COL}&disparo_id=eq.${d.id}&order=${COL}.asc&limit=1000&offset=${off}`);
      rows.forEach(e => feitos.add(e[COL]));
      if (rows.length < 1000) break;
    }
    let publico;
    if (ehC) { baseC = baseC || await C.carregar(db); publico = C.aptos(C.filtrar(baseC, d.filtro || {}), d.canal); }
    else { base = base || await carregar(db, cfg0); publico = aptos(filtrar(base, d.filtro || {}), d.canal); }
    const pendentes = publico.filter(l => !feitos.has(l.id));
    let enviados = d.enviados || 0, falhas = d.falhas || 0, erro = null;
    const patch0 = { status: 'enviando', atualizado_em: new Date().toISOString() };
    if (d.status === 'agendado') patch0.total = publico.length;
    await db.update('sdb_disparos', `id=eq.${d.id}`, patch0);
    const vars = (x, ch) => ehC ? varsContato(x, d, ch) : varsDe(x);
    const linha = (id, ok, er) => ({ disparo_id: d.id, [COL]: id, status: ok ? 'enviado' : 'falha', erro: ok ? null : String(er).slice(0, 200) });

    if (d.canal === 'email') {
      for (let i = 0; i < pendentes.length && Date.now() - t0 < limiteMs; i += 100) {
        const lote = pendentes.slice(i, i + 100);
        const r = await enviarLote(lote.map(l => ({
          ref: l.id, para: l.email, assunto: preencher(d.assunto, vars(l, 'e')), texto: preencher(d.texto, vars(l, 'e')),
          descadastro: ehC ? `${SITE_URL()}/api/disparos?acao=descadastro&c=${l.token}` : linkSair(l),
          pixel: ehC ? `${SITE_URL()}/api/t?o=${l.token}` : null,
        })));
        const linhas = [...r.ok.map(id => linha(id, true)), ...r.falhas.map(f => linha(f.ref, false, f.erro))];
        if (linhas.length) await db.insert(T_ENV, linhas);
        enviados += r.ok.length; falhas += r.falhas.length;
        if (r.parar) { erro = r.falhas[0]?.erro || 'Resend recusou'; break; }
        await db.update('sdb_disparos', `id=eq.${d.id}`, { enviados, falhas, atualizado_em: new Date().toISOString() });
        if (!r.simulado) await espera(600); // limite padrão do Resend: 2 chamadas por segundo
      }
    } else {
      if (!d.flow_ns) erro = 'Falta o ID do fluxo do ManyChat (flow_ns)';
      for (let i = 0; !erro && i < pendentes.length && Date.now() - t0 < limiteMs; i += 5) {
        const lote = pendentes.slice(i, i + 5);
        const res = await Promise.all(lote.map(async (l) => {
          try {
            let mcId = l.manychat_id;
            if (ehC) {
              // contato da lista: cria no ManyChat e grava o link do convite no campo convite_link (usado no botão do template)
              mcId = await garantirContato(l, { convite_link: vars(l, 'w').link });
              if (mcId !== l.manychat_id) { l.manychat_id = mcId; await db.update('sdb_contatos', `id=eq.${l.id}`, { manychat_id: mcId }); }
            }
            await enviarFluxo(mcId, d.flow_ns); return null;
          } catch (e) { return e.message || 'erro'; }
        }));
        await db.insert(T_ENV, lote.map((l, k) => linha(l.id, !res[k], res[k])));
        enviados += res.filter(x => !x).length; falhas += res.filter(Boolean).length;
        if (res.every(x => x && /MANYCHAT_API_KEY|token|unauthor/i.test(x))) { erro = res[0]; break; }
        if (i % 50 === 0) await db.update('sdb_disparos', `id=eq.${d.id}`, { enviados, falhas, atualizado_em: new Date().toISOString() });
      }
    }
    const restam = pendentes.length - (enviados - (d.enviados || 0)) - (falhas - (d.falhas || 0));
    const status = erro ? 'erro' : restam <= 0 ? 'concluido' : 'enviando';
    await db.update('sdb_disparos', `id=eq.${d.id}`, { enviados, falhas, status, erro, atualizado_em: new Date().toISOString() });
    resumo.push({ id: d.id, status, enviados, falhas, restam: Math.max(restam, 0) });
  }
  return resumo;
}

function paginaSaida(ok) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semana do Barbeiro</title>
<body style="margin:0;background:#ede7dc;font:16px/1.6 Arial,sans-serif;color:#15120e;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box">
<div style="max-width:420px;background:#fffdf8;border:1px solid #d9cfbe;border-radius:12px;padding:28px;text-align:center">
<h1 style="font:400 28px Impact,'Arial Narrow',sans-serif;text-transform:uppercase;margin:0 0 8px">${ok ? 'Pronto' : 'Link inválido'}</h1>
<p style="margin:0">${ok ? 'Você não vai mais receber e-mails da Semana do Barbeiro. Suas aulas continuam liberadas no app.' : 'Não encontramos este cadastro.'}</p></div></body></html>`;
}

module.exports = handler(['GET', 'POST'], async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const acao = u.searchParams.get('acao') || 'lista';

  // Descadastro de e-mail (público, pelo token do aluno)
  if (acao === 'descadastro') {
    const t = u.searchParams.get('t') || '', ct = u.searchParams.get('c') || '';
    let ok = false;
    if (/^[a-f0-9]{16,40}$/.test(ct)) {
      const c = await db.one('sdb_contatos', `select=id&token=eq.${ct}`);
      if (c) { await db.update('sdb_contatos', `id=eq.${c.id}`, { email_optout: true }); ok = true; }
    } else if (TOKEN.test(t)) {
      const lead = await db.one('sdb_leads', `select=id&token=eq.${t}`);
      if (lead) { await db.update('sdb_leads', `id=eq.${lead.id}`, { email_optout: true }); await logEvento('email_descadastro', { lead_id: lead.id }); ok = true; }
    }
    res.statusCode = ok ? 200 : 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(paginaSaida(ok));
  }

  // Batida do agendador (pg_cron do Supabase), sem senha: só processa o que já está programado e vencido,
  // e no máximo uma vez a cada 4 minutos, então chamar de fora não adianta nem envia nada antes da hora.
  if (acao === 'tick') {
    const c0 = await config();
    if (agora() - (Date.parse(c0.disparos_ultimo || '') || 0) < 4 * 60e3) return send(res, 200, { ok: true, pulado: true });
    return send(res, 200, { ok: true, processados: (await processar()).length });
  }

  if (acao === 'processar') {
    if (!cronOk(req)) return send(res, 401, { erro: 'Não autorizado' });
    return send(res, 200, { ok: true, processados: await processar() });
  }

  // Extensão do WhatsApp Web (grupos, comunidades e canal): chave própria, não usa a senha do painel
  if (G.EXT.has(acao)) {
    // Reserva: se o agendador (pg_cron) falhar, a extensão, que consulta a fila a cada minuto, processa os disparos atrasados
    if (acao === 'wa_fila' && G.extOk(req)) {
      const c0 = await config();
      if (agora() - (Date.parse(c0.disparos_ultimo || '') || 0) > 6 * 60e3) await processar(20000).catch(e => console.error('processar reserva', e.message));
    }
    return G.extensao(acao, req, res, req.method === 'POST' ? await readJson(req) : {});
  }

  if (!adminOk(req)) return send(res, 401, { erro: 'Senha inválida' });
  const b = req.method === 'POST' ? await readJson(req) : {};
  if (G.PAINEL.has(acao)) return G.painel(acao, req, res, b);
  const cfg = await config();

  if (acao === 'lista') {
    const disparos = await db.select('sdb_disparos', 'select=*&order=agendar_em.desc&limit=200');
    return send(res, 200, {
      disparos: disparos.map(d => ({ ...d, publico: descrever(d.filtro || {}) })),
      copies: ajustar(COPIES, cfg).map(c => ({ ...c, flow_ns: c.flow_cfg ? cfg[c.flow_cfg] || '' : undefined, sugerido_em: c.quando ? dataDe(turmaAlvo(), c.quando) : null })),
      situacoes: SITUACOES, perfis: PERFIS, perguntas: PERGUNTAS.map(q => ({ k: q.k, p: q.p, o: q.o })),
      custo_wa: Number(cfg.whatsapp_custo_usd || 0.0718),
      email_ok: !!process.env.RESEND_API_KEY, whatsapp_ok: !!process.env.MANYCHAT_API_KEY, simulado: process.env.SDB_LOCAL === '1',
      agora: new Date(agora()).toISOString(), ultimo_processamento: cfg.disparos_ultimo || null, turma_alvo: turmaAlvo(), turmas: turmasRecentes(), auto: cfg.disparos_auto !== '0',
    });
  }

  // ---------- Configurações (sdb_config editável pelo painel; chaves de API ficam na Vercel) ----------
  if (acao === 'config') {
    // Situação das chaves de API (só "tem / não tem": o valor nunca sai do servidor)
    const E = process.env, tem = (k) => !!(E[k] && String(E[k]).trim());
    const chaves = [
      { nome: 'ASAAS_API_KEY', rotulo: 'Asaas (certificado e Barbeearia)', ok: tem('ASAAS_API_KEY'), obs: tem('ASAAS_API_KEY') ? (E.ASAAS_ENV === 'producao' ? 'produção' : 'modo teste (sandbox): falta ASAAS_ENV=producao') : 'sem ela o certificado não gera cobrança' },
      { nome: 'ASAAS_WEBHOOK_TOKEN', rotulo: 'Asaas: token do webhook', ok: tem('ASAAS_WEBHOOK_TOKEN'), obs: 'confirma o pagamento sozinho' },
      { nome: 'HOTMART_HOTTOK', rotulo: 'Hotmart (venda do curso)', ok: tem('HOTMART_HOTTOK'), obs: 'libera o aluno quando a Hotmart avisa a compra' },
      { nome: 'RESEND_API_KEY', rotulo: 'Resend (e-mails)', ok: tem('RESEND_API_KEY'), obs: 'envio dos e-mails das aulas' },
      { nome: 'MANYCHAT_API_KEY', rotulo: 'ManyChat (WhatsApp 1 a 1)', ok: tem('MANYCHAT_API_KEY'), obs: 'opcional enquanto não houver canal de WhatsApp no ManyChat' },
      { nome: 'SUPABASE_SERVICE_ROLE_KEY', rotulo: 'Supabase (banco)', ok: tem('SUPABASE_SERVICE_ROLE_KEY'), obs: 'banco de dados' },
    ];
    return send(res, 200, { chaves, grupos: CAMPOS_CFG.map(g => ({ titulo: g.titulo, campos: g.campos.map(c => ({ ...c, valor: cfg[c.chave] ?? '' })) })) });
  }
  if (acao === 'config_salvar') {
    const campo = CAMPOS_CFG.flatMap(g => g.campos).find(c => c.chave === b.chave);
    if (!campo) throw fail(400, 'Configuração desconhecida');
    let v = String(b.valor ?? '').trim().slice(0, 500);
    const erro = (m) => { throw fail(400, `${campo.rotulo}: ${m}`); };
    if (campo.tipo === 'fone') { v = normalizaWhats(v) || erro('use DDD + número, ex.: (47) 99999-9999'); }
    else if (campo.tipo === 'url') { if (v && !/^https:\/\/[^\s]+$/i.test(v)) erro('o link precisa começar com https://'); if (!v && !campo.opcional) erro('não pode ficar vazio'); }
    else if (campo.tipo === 'num') { v = v.replace(',', '.'); if (!/^\d+(\.\d{1,2})?$/.test(v)) erro('use só número, ex.: 147 ou 19.70'); }
    else if (campo.tipo === 'int') { if (!/^\d{1,4}$/.test(v)) erro('use um número inteiro'); }
    else if (campo.tipo === 'hora') { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) erro('use HH:MM, ex.: 08:00'); }
    else if (campo.tipo === 'dias') { if (!/^[1-7](,[1-7])*$/.test(v)) erro('use os dias separados por vírgula, ex.: 1,5 (1 = segunda)'); }
    else if (campo.tipo === 'bool') { v = v === '1' || v === 'true' ? '1' : '0'; }
    else if (campo.tipo === 'sel') { if (!campo.opcoes.some(o => o[0] === v)) erro('opção inválida'); }
    else if (!v && !campo.opcional) erro('não pode ficar vazio');
    await G.cfgSet(campo.chave, v);
    await logEvento('config_alterada', { payload: { chave: campo.chave } });
    return send(res, 200, { ok: true, valor: v });
  }

  // ---------- Mensagens (biblioteca editável) ----------
  if (acao === 'copies') {
    const quandoTxt = (q) => q ? `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'][q.dia + 1] || `dia ${q.dia}`} ${q.hora.replace(':00', 'h').replace(':', 'h')}` : null;
    const orig = Object.fromEntries([...COPIES, ...COPIES_GRUPO].map(c => [c.id, c]));
    const email = ajustar(COPIES, cfg).filter(c => c.canal === 'email').map(c => ({ id: c.id, titulo: c.titulo, assunto: c.assunto, texto: c.texto, quando: quandoTxt(c.quando), automatico: !!(c.quando || c.automatico), publico: c.publico || 'leads', filtro: descrever(c.filtro || {}), ajustada: !!c.ajustada, original: { assunto: orig[c.id].assunto, texto: orig[c.id].texto } }));
    const wa = ajustar(COPIES, cfg).filter(c => c.canal === 'whatsapp').map(c => ({ id: c.id, titulo: c.titulo, resumo: c.resumo, quando: quandoTxt(c.quando), flow_cfg: c.flow_cfg, flow_ns: c.flow_cfg ? cfg[c.flow_cfg] || '' : '', publico: c.publico || 'leads', filtro: descrever(c.filtro || {}) }));
    const grupos = ajustar(COPIES_GRUPO, cfg).map(c => ({ id: c.id, titulo: c.titulo, texto: c.texto, quando: c.auto ? c.auto.map(quandoTxt).join(', ') : null, automatico: !!c.auto, ajustada: !!c.ajustada, original: { texto: orig[c.id].texto } }));
    return send(res, 200, { email, whatsapp: wa, grupos });
  }
  if (acao === 'copy_salvar') {
    const id = String(b.id || '');
    const c = [...COPIES, ...COPIES_GRUPO].find(x => x.id === id);
    if (!c) throw fail(400, 'Mensagem não encontrada');
    if (c.canal === 'whatsapp') {
      const flow = String(b.flow_ns || '').trim().slice(0, 120);
      if (flow && !/^[\w:.-]+$/.test(flow)) throw fail(400, 'ID do fluxo inválido');
      await G.cfgSet(c.flow_cfg, flow);
      return send(res, 200, { ok: true });
    }
    const texto = String(b.texto || '').trim().slice(0, 20000), assunto = String(b.assunto || '').trim().slice(0, 200);
    if (texto.length < 2) throw fail(400, 'O texto não pode ficar vazio');
    if (c.assunto != null && !assunto) throw fail(400, 'O assunto não pode ficar vazio');
    await G.cfgSet(`copy_${id}`, JSON.stringify(c.assunto != null ? { assunto, texto } : { texto }));
    return send(res, 200, { ok: true });
  }
  if (acao === 'copy_restaurar') {
    const id = String(b.id || '');
    if (![...COPIES, ...COPIES_GRUPO].some(x => x.id === id)) throw fail(400, 'Mensagem não encontrada');
    await G.cfgSet(`copy_${id}`, '');
    return send(res, 200, { ok: true });
  }

  if (acao === 'contar') {
    const canal = b.canal === 'whatsapp' ? 'whatsapp' : 'email';
    if (b.publico === 'contatos') {
      const cs = C.filtrar(await C.carregar(db), limpaFiltroC(b.filtro));
      return send(res, 200, { publico: cs.length, aptos: C.aptos(cs, canal).length });
    }
    const lista = filtrar(await carregar(db, cfg), limpaFiltro(b.filtro));
    return send(res, 200, { publico: lista.length, aptos: aptos(lista, canal).length });
  }

  if (acao === 'criar') {
    const canal = b.canal === 'whatsapp' ? 'whatsapp' : b.canal === 'email' ? 'email' : null;
    if (!canal) throw fail(400, 'Escolha o canal');
    const assunto = String(b.assunto || '').trim().slice(0, 200), texto = String(b.texto || '').trim().slice(0, 20000), flow_ns = String(b.flow_ns || '').trim().slice(0, 120);
    if (canal === 'email' && (!assunto || !texto)) throw fail(400, 'Preencha o assunto e o texto do e-mail');
    if (canal === 'whatsapp' && !/^[\w:.-]+$/.test(flow_ns)) throw fail(400, 'Informe o ID do fluxo do ManyChat (flow_ns)');
    const quando = b.agendar_em ? new Date(b.agendar_em) : new Date(agora());
    if (isNaN(quando)) throw fail(400, 'Data inválida');
    const ehC = b.publico === 'contatos';
    const d = await db.insert('sdb_disparos', {
      canal, titulo: String(b.titulo || (canal === 'email' ? assunto : 'WhatsApp')).slice(0, 120), copy_id: b.copy_id || null,
      publico: ehC ? 'contatos' : 'leads', link_tipo: ehC ? (b.link_tipo === 'barbeearia' ? 'barbeearia' : 'semana') : null,
      filtro: ehC ? limpaFiltroC(b.filtro) : limpaFiltro(b.filtro), assunto: canal === 'email' ? assunto : null, texto: canal === 'email' ? texto : null, flow_ns: canal === 'whatsapp' ? flow_ns : null,
      agendar_em: quando.toISOString(), status: 'agendado', total: 0, enviados: 0, falhas: 0,
    });
    return send(res, 200, { ok: true, disparo: d });
  }

  // ---------- Gestão de leads (listas importadas) ----------
  if (acao === 'contatos_resumo') {
    const cs = await C.carregar(db);
    const listas = {}, blocos = {};
    cs.forEach(c => {
      const l = listas[c.lista] = listas[c.lista] || { lista: c.lista, total: 0, email: 0, whatsapp: 0, regioes: {} };
      l.total++; if (c.email && !c.email_optout) l.email++; if (c.whatsapp && !c.wa_optout) l.whatsapp++;
      l.regioes[c.regiao || 'Sem região'] = (l.regioes[c.regiao || 'Sem região'] || 0) + 1;
      if (c.bloco) {
        const k = `${c.lista}|${c.bloco}`;
        const bl = blocos[k] = blocos[k] || { lista: c.lista, bloco: c.bloco, total: 0, convidados: 0, abriram: 0, clicaram: 0, cadastraram: 0, sairam: 0 };
        bl.total++; if (c.convites) bl.convidados++; if (c.aberto_em || c.clicado_em) bl.abriram++; if (c.clicado_em) bl.clicaram++; if (c.lead_id) bl.cadastraram++; if (c.email_optout) bl.sairam++;
      }
    });
    const ufs = [...new Set(cs.map(c => c.uf).filter(Boolean))].sort();
    return send(res, 200, { listas: Object.values(listas), blocos: Object.values(blocos).sort((a, b) => a.bloco.localeCompare(b.bloco)), ufs, engajamento: C.ENGAJAMENTO, regioes: REGIOES_OK });
  }

  if (acao === 'contatos_contar') {
    const cs = C.filtrar(await C.carregar(db), limpaFiltroC(b.filtro));
    const porRegiao = cs.reduce((m, c) => { m[c.regiao || 'Sem região'] = (m[c.regiao || 'Sem região'] || 0) + 1; return m; }, {});
    return send(res, 200, { total: cs.length, email: C.aptos(cs, 'email').length, whatsapp: C.aptos(cs, 'whatsapp').length, por_regiao: porRegiao, amostra: cs.slice(0, 8).map(c => ({ nome: c.nome, cidade: c.cidade, uf: c.uf, bloco: c.bloco })) });
  }

  if (acao === 'contatos_bloco') {
    const f = limpaFiltroC({ ...b.filtro, bloco: '-' });
    if (!f.lista) throw fail(400, 'Escolha a lista');
    const tamanho = Math.min(Math.max(Number(b.tamanho) || 3000, 1), 20000);
    const nome = String(b.nome || '').trim().slice(0, 80);
    if (!nome) throw fail(400, 'Dê um nome ao bloco');
    const cs = C.filtrar(await C.carregar(db, f.lista), f).slice(0, tamanho);
    for (let i = 0; i < cs.length; i += 200) {
      const ids = cs.slice(i, i + 200).map(c => c.id);
      await db.update('sdb_contatos', `id=in.(${ids.join(',')})`, { bloco: nome });
    }
    return send(res, 200, { ok: true, bloco: nome, total: cs.length });
  }

  if (acao === 'contatos_soltar_bloco') {
    const lista = String(b.lista || '').slice(0, 60), bloco = String(b.bloco || '').slice(0, 80);
    if (!lista || !bloco) throw fail(400, 'Bloco inválido');
    await db.update('sdb_contatos', `lista=eq.${encodeURIComponent(lista)}&bloco=eq.${encodeURIComponent(bloco)}`, { bloco: null });
    return send(res, 200, { ok: true });
  }

  if (acao === 'contatos_importar') {
    const lista = String(b.lista || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 60);
    if (!lista) throw fail(400, 'Dê um nome à lista (ex.: semana_2020, alunos_barberschool)');
    const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 1000) : [];
    const novos = [], vistos = new Set();
    let invalidos = 0, repetidos = 0;
    for (const x of linhas) {
      const c = C.normalizar(x || {}, lista);
      if (!c) { invalidos++; continue; }
      const k1 = c.whatsapp && `w${c.whatsapp}`, k2 = c.email && `e${c.email}`;
      if ((k1 && vistos.has(k1)) || (k2 && vistos.has(k2))) { repetidos++; continue; }
      if (k1) vistos.add(k1); if (k2) vistos.add(k2);
      novos.push(c);
    }
    // já existe nesta lista (mesmo WhatsApp ou e-mail)?
    const q = (vals) => `in.(${vals.map(v => `"${v}"`).join(',')})`;
    const ja = new Set();
    for (let i = 0; i < novos.length; i += 150) {
      const p = novos.slice(i, i + 150);
      const ws = p.map(c => c.whatsapp).filter(Boolean), es = p.map(c => c.email).filter(Boolean);
      if (ws.length) (await db.select('sdb_contatos', `select=whatsapp&lista=eq.${encodeURIComponent(lista)}&whatsapp=${encodeURIComponent(q(ws))}`)).forEach(r => ja.add(`w${r.whatsapp}`));
      if (es.length) (await db.select('sdb_contatos', `select=email&lista=eq.${encodeURIComponent(lista)}&email=${encodeURIComponent(q(es))}`)).forEach(r => ja.add(`e${r.email}`));
    }
    const inserir = novos.filter(c => !(c.whatsapp && ja.has(`w${c.whatsapp}`)) && !(c.email && ja.has(`e${c.email}`)));
    repetidos += novos.length - inserir.length;
    for (let i = 0; i < inserir.length; i += 500) await db.insert('sdb_contatos', inserir.slice(i, i + 500));
    return send(res, 200, { ok: true, lista, importados: inserir.length, repetidos, invalidos });
  }

  if (acao === 'semana') {
    const turma = /^\d{4}-\d{2}-\d{2}$/.test(b.turma || '') ? b.turma : turmaAlvo();
    return send(res, 200, { ok: true, turma, ...(await garantirCalendario(turma, cfg, 0)) });
  }

  if (acao === 'cancelar') {
    const id = Number(b.id);
    if (!Number.isInteger(id)) throw fail(400, 'Disparo inválido');
    await db.update('sdb_disparos', `id=eq.${id}&status=in.(agendado,enviando,erro)`, { status: 'cancelado', atualizado_em: new Date().toISOString() });
    return send(res, 200, { ok: true });
  }

  if (acao === 'previa') {
    const v = { nome: 'Rafael', app_link: `${APP_URL()}/?t=exemplo` };
    return send(res, 200, { assunto: preencher(b.assunto, v), html: layout({ corpo: corpoHtml(preencher(b.texto, v)), descadastro: '#' }) });
  }

  if (acao === 'teste') {
    const para = String(b.para || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw fail(400, 'E-mail de teste inválido');
    const v = { nome: 'Rafael', app_link: `${APP_URL()}/?t=exemplo` };
    const r = await enviarLote([{ ref: 'teste', para, assunto: '[TESTE] ' + preencher(b.assunto, v), texto: preencher(b.texto, v), descadastro: `${SITE_URL()}/api/disparos?acao=descadastro&t=exemplo` }]);
    if (r.falhas.length) throw fail(502, r.falhas[0].erro);
    return send(res, 200, { ok: true, simulado: !!r.simulado });
  }

  throw fail(400, 'Ação inválida');
});

module.exports.processar = processar;
