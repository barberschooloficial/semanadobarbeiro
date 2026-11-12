// Avisos em grupos, comunidades e canal do WhatsApp, enviados pela extensão do Chrome (pasta extensao-whatsapp/).
// A extensão roda no WhatsApp Web do número de avisos, busca a fila aqui e devolve o resultado de cada envio.
//
// Extensão (header x-ext-key = WA_EXT_KEY):  POST ?acao=wa_sync · GET ?acao=wa_fila|wa_resumo · POST ?acao=wa_resultado
// Painel   (header x-admin-key):             GET ?acao=wa_painel · POST ?acao=wa_destino|wa_criar|wa_cancelar|wa_semana
const crypto = require('crypto');
const { db, config } = require('./db');
const { send, fail } = require('./http');
const { agora } = require('./util');
const { em, rotulo, segundaDa } = require('./turma');
const { COPIES_GRUPO } = require('./copies-grupo');
const { ajustar } = require('./copies');

const TIPOS = new Set(['grupo', 'comunidade', 'canal']);
const CATEGORIAS = { semana: 'Semana do Barbeiro', alunos_bs: 'Alunos Barber School', comunidade: 'Comunidade', canal: 'Canal', outro: 'Outro', nenhuma: 'Sem categoria' };
const ID_WA = /^[0-9-]{5,40}@(g\.us|newsletter)$/;
const agoraIso = () => new Date(agora()).toISOString();
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

function extOk(req) {
  const esperado = process.env.WA_EXT_KEY || '';
  const recebido = String(req.headers['x-ext-key'] || '');
  return esperado.length >= 16 && esperado.length === recebido.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

async function cfgSet(chave, valor) {
  await db.upsert('sdb_config', { chave, valor: String(valor) }, 'chave').catch(e => console.error('cfg', chave, e.message));
  config.limpar();
}

// Todas as linhas (PostgREST devolve no máximo 1000 por chamada)
async function todos(tabela, query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await db.select(tabela, `${query}&limit=1000&offset=${off}`);
    out.push(...r); if (r.length < 1000) return out;
  }
}

// Calendário automático: cria (uma vez só) os avisos da turma nos destinos da categoria "semana".
async function garantirCalendario(turma, { folgaMs = 10 * 60e3 } = {}) {
  const destinos = (await todos('sdb_wa_destinos', 'select=id&ativo=eq.true&categoria=eq.semana&order=id.asc')).map(d => d.id);
  if (!destinos.length) return { criados: [], pulados: [{ titulo: 'Calendário dos grupos', motivo: 'nenhum grupo marcado como "Semana do Barbeiro"' }] };
  const ja = new Set((await todos('sdb_wa_avisos', `select=copy_id,agendar_em&status=neq.cancelado&agendar_em=gte.${encodeURIComponent(new Date(em(turma, -2)).toISOString())}&order=id.asc`))
    .map(a => `${a.copy_id}|${new Date(a.agendar_em).toISOString()}`));
  const criados = [], pulados = [];
  const cfgG = await config();
  for (const c of ajustar(COPIES_GRUPO, cfgG).filter(c => c.auto)) {
    for (const q of c.auto) {
      const quando = new Date(em(turma, q.dia, q.hora)).toISOString();
      if (ja.has(`${c.id}|${quando}`)) { pulados.push({ titulo: c.titulo, motivo: 'já programado' }); continue; }
      if (Date.parse(quando) < agora() - folgaMs) { pulados.push({ titulo: c.titulo, motivo: 'horário já passou' }); continue; }
      await db.insert('sdb_wa_avisos', {
        titulo: `${c.titulo} · turma ${rotulo(turma)}`, copy_id: c.id, texto: c.texto, destinos, agendar_em: quando,
        expira_em: new Date(Date.parse(quando) + 3 * 3600e3).toISOString(), // computador desligado: depois de 3h o aviso perde o sentido
        status: 'agendado', total: destinos.length, enviados: 0, falhas: 0, origem: 'auto',
      });
      criados.push(c.titulo);
    }
  }
  return { criados, pulados };
}

async function semanaAuto() {
  const cfg = await config();
  if (cfg.grupos_auto === '0') return;
  const t = agora();
  const turma = segundaDa(t);
  if (t > em(turma, 6, '23:59')) return;
  await garantirCalendario(turma).catch(e => console.error('grupos calendario', e.message));
}

// Resumo para a extensão e o painel: sincronização, grupos que recebem, fila e últimos envios
async function resumo() {
  const cfg = await config();
  const t = agoraIso();
  const visto = cfg.wa_ext_visto || null;
  const ativos = await todos('sdb_wa_destinos', 'select=id,nome,tipo,categoria&ativo=eq.true&order=nome.asc');
  const total = (await todos('sdb_wa_destinos', 'select=id&order=id.asc')).length;
  const abertos = await db.select('sdb_wa_avisos', 'select=id,titulo,agendar_em,status,total,enviados,falhas&status=in.(agendado,enviando)&order=agendar_em.asc&limit=50');
  const agoraFila = abertos.filter(a => a.agendar_em <= t);
  const ultimos = await db.select('sdb_wa_aviso_envios', 'select=aviso_id,destino_id,status,erro,enviado_em&order=enviado_em.desc&limit=6');
  const nomesD = Object.fromEntries((ultimos.length ? await db.select('sdb_wa_destinos', `select=id,nome&id=in.(${[...new Set(ultimos.map(u => `"${u.destino_id}"`))].join(',')})`) : []).map(d => [d.id, d.nome]));
  const titulos = Object.fromEntries((ultimos.length ? await db.select('sdb_wa_avisos', `select=id,titulo&id=in.(${[...new Set(ultimos.map(u => u.aviso_id))].join(',')})`) : []).map(a => [a.id, a.titulo]));
  return {
    agora: t,
    extensao: { visto_em: visto, online: !!visto && agora() - Date.parse(visto) < 3 * 60e3, numero: cfg.wa_ext_numero || '' },
    sync: { em: cfg.wa_ext_sync_em || null, total: Number(cfg.wa_ext_sync_total || total) },
    destinos: { total, ativos: ativos.map(d => ({ nome: d.nome, tipo: d.tipo, categoria: CATEGORIAS[d.categoria] || d.categoria })) },
    fila: {
      agora: agoraFila.length,
      pendentes_agora: agoraFila.reduce((n, a) => n + Math.max(0, (a.total || 0) - (a.enviados || 0) - (a.falhas || 0)), 0),
      proximos: abertos.filter(a => a.agendar_em > t).slice(0, 5).map(a => ({ titulo: a.titulo, agendar_em: a.agendar_em, total: a.total })),
      total_agendados: abertos.length,
    },
    ultimos: ultimos.map(u => ({ titulo: titulos[u.aviso_id] || 'Aviso', destino: nomesD[u.destino_id] || u.destino_id, status: u.status, erro: u.erro, em: u.enviado_em })),
    auto: cfg.grupos_auto !== '0',
  };
}

// ---------- extensão ----------
async function extensao(acao, req, res, b) {
  if (!extOk(req)) return send(res, 401, { erro: 'Chave da extensão inválida' });
  await cfgSet('wa_ext_visto', agoraIso());

  if (acao === 'wa_sync') {
    const numero = txt(b.numero, 30).replace(/\D/g, '');
    if (numero) await cfgSet('wa_ext_numero', numero);
    if (b.versao) await cfgSet('wa_ext_versao', txt(b.versao, 20));
    const lista = Array.isArray(b.destinos) ? b.destinos.slice(0, 2000) : [];
    let n = 0;
    for (const d of lista) {
      const id = txt(d.id, 60), tipo = txt(d.tipo, 20);
      if (!ID_WA.test(id) || !TIPOS.has(tipo)) continue;
      const atual = await db.one('sdb_wa_destinos', `select=id&id=eq.${encodeURIComponent(id)}`);
      const base = { nome: txt(d.nome, 120) || id, tipo, admin: !!d.admin, participantes: Number.isFinite(+d.participantes) ? Math.round(+d.participantes) : null, envio_id: ID_WA.test(txt(d.envio_id, 60)) ? txt(d.envio_id, 60) : id, visto_em: agoraIso() };
      if (atual) await db.update('sdb_wa_destinos', `id=eq.${encodeURIComponent(id)}`, base);
      else await db.insert('sdb_wa_destinos', { id, ...base, categoria: tipo === 'canal' ? 'canal' : tipo === 'comunidade' ? 'comunidade' : 'nenhuma', ativo: false });
      n++;
    }
    await cfgSet('wa_ext_sync_em', agoraIso());
    await cfgSet('wa_ext_sync_total', n);
    return send(res, 200, { ok: true, recebidos: n, resumo: await resumo() });
  }

  if (acao === 'wa_fila') {
    await semanaAuto();
    const cfg = await config();
    const agoraT = agoraIso();
    const fila = await db.select('sdb_wa_avisos', `select=*&status=in.(agendado,enviando)&agendar_em=lte.${encodeURIComponent(agoraT)}&order=agendar_em.asc&limit=5`);
    for (const a of fila) {
      if (a.expira_em && Date.parse(a.expira_em) < agora()) {
        await db.update('sdb_wa_avisos', `id=eq.${a.id}`, { status: 'expirado', erro: 'O WhatsApp Web não estava aberto no horário', atualizado_em: agoraT });
        continue;
      }
      const feitos = new Set((await todos('sdb_wa_aviso_envios', `select=destino_id&aviso_id=eq.${a.id}&order=destino_id.asc`)).map(e => e.destino_id));
      const ids = (a.destinos || []).filter(id => !feitos.has(id));
      if (!ids.length) { await db.update('sdb_wa_avisos', `id=eq.${a.id}`, { status: 'concluido', atualizado_em: agoraT }); continue; }
      const ds = await db.select('sdb_wa_destinos', `select=id,nome,tipo,envio_id&id=in.(${ids.map(i => `"${i}"`).join(',')})`);
      if (a.status === 'agendado') await db.update('sdb_wa_avisos', `id=eq.${a.id}`, { status: 'enviando', atualizado_em: agoraT });
      return send(res, 200, {
        aviso: { id: a.id, titulo: a.titulo, texto: a.texto, imagem_url: a.imagem_url || null },
        destinos: ids.map(id => ds.find(d => d.id === id) || { id, nome: id, tipo: id.endsWith('@newsletter') ? 'canal' : 'grupo', envio_id: id }),
        intervalo: [Math.max(8, Number(cfg.wa_intervalo_min || 20)), Math.max(15, Number(cfg.wa_intervalo_max || 90))],
      });
    }
    return send(res, 200, { aviso: null });
  }

  if (acao === 'wa_resumo') return send(res, 200, await resumo());

  if (acao === 'wa_resultado') {
    const id = Number(b.aviso_id), destino = txt(b.destino_id, 60);
    if (!Number.isInteger(id) || !ID_WA.test(destino)) throw fail(400, 'Resultado inválido');
    const a = await db.one('sdb_wa_avisos', `select=*&id=eq.${id}`);
    if (!a || !(a.destinos || []).includes(destino)) throw fail(404, 'Aviso não encontrado');
    try {
      await db.insert('sdb_wa_aviso_envios', { aviso_id: id, destino_id: destino, status: b.ok ? 'enviado' : 'falha', erro: b.ok ? null : txt(b.erro || 'erro', 200), msg_id: txt(b.msg_id, 120) || null });
    } catch (e) { if (e.code !== '23505') throw e; return send(res, 200, { ok: true, repetido: true }); }
    const env = await todos('sdb_wa_aviso_envios', `select=status&aviso_id=eq.${id}&order=destino_id.asc`);
    const enviados = env.filter(e => e.status === 'enviado').length, falhas = env.length - enviados;
    const status = a.status === 'cancelado' ? 'cancelado' : env.length >= (a.destinos || []).length ? 'concluido' : 'enviando';
    await db.update('sdb_wa_avisos', `id=eq.${id}`, { enviados, falhas, status, atualizado_em: agoraIso() });
    return send(res, 200, { ok: true, status });
  }
  return send(res, 400, { erro: 'Ação inválida' });
}

// ---------- painel ----------
async function painel(acao, req, res, b) {
  if (acao === 'wa_painel') {
    const cfg = await config();
    const destinos = await todos('sdb_wa_destinos', 'select=*&order=nome.asc');
    const avisos = await db.select('sdb_wa_avisos', 'select=*&order=agendar_em.desc&limit=120');
    const visto = cfg.wa_ext_visto || null;
    return send(res, 200, {
      destinos, avisos, categorias: CATEGORIAS, copies: ajustar(COPIES_GRUPO, cfg).map(c => ({ id: c.id, titulo: c.titulo, texto: c.texto, auto: !!c.auto, ajustada: !!c.ajustada })),
      extensao: { visto_em: visto, online: !!visto && agora() - Date.parse(visto) < 3 * 60e3, numero: cfg.wa_ext_numero || '', versao: cfg.wa_ext_versao || '', chave_ok: (process.env.WA_EXT_KEY || '').length >= 16, chave: process.env.WA_EXT_KEY || '' }, // só chega aqui quem passou pela senha do painel
      auto: cfg.grupos_auto !== '0', limite_dia: Number(cfg.wa_limite_dia || 4), agora: agoraIso(), resumo: await resumo(),
    });
  }

  if (acao === 'wa_destino') {
    const id = txt(b.id, 60);
    if (!ID_WA.test(id)) throw fail(400, 'Destino inválido');
    const patch = {};
    if (b.categoria != null) { if (!CATEGORIAS[b.categoria]) throw fail(400, 'Categoria inválida'); patch.categoria = b.categoria; }
    if (b.ativo != null) patch.ativo = !!b.ativo;
    const r = await db.update('sdb_wa_destinos', `id=eq.${encodeURIComponent(id)}`, patch);
    return send(res, 200, { ok: true, destino: r[0] || null });
  }

  if (acao === 'wa_criar') {
    const texto = txt(b.texto, 4000);
    if (texto.length < 2) throw fail(400, 'Escreva o aviso');
    const imagem_url = txt(b.imagem_url, 500);
    if (imagem_url && !/^https:\/\/[^\s]+$/i.test(imagem_url)) throw fail(400, 'A imagem precisa de um link https');
    const pedidos = Array.isArray(b.destinos) ? [...new Set(b.destinos.map(x => txt(x, 60)).filter(x => ID_WA.test(x)))] : [];
    if (!pedidos.length) throw fail(400, 'Marque pelo menos um grupo, comunidade ou canal');
    const validos = await db.select('sdb_wa_destinos', `select=id,nome&ativo=eq.true&id=in.(${pedidos.map(i => `"${i}"`).join(',')})`);
    if (validos.length !== pedidos.length) throw fail(400, 'Algum destino está desativado ou não existe mais. Atualize a lista.');
    const quando = b.agendar_em ? new Date(b.agendar_em) : new Date(agora());
    if (isNaN(quando)) throw fail(400, 'Data inválida');
    // Limite por destino e por dia (Brasília): protege o número contra bloqueio
    const cfg = await config();
    const limite = Number(cfg.wa_limite_dia || 4);
    const dia = new Date(quando.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
    const ini = new Date(`${dia}T00:00:00-03:00`).toISOString(), fim = new Date(`${dia}T23:59:59-03:00`).toISOString();
    const doDia = await db.select('sdb_wa_avisos', `select=destinos&status=in.(agendado,enviando,concluido)&agendar_em=gte.${encodeURIComponent(ini)}&agendar_em=lte.${encodeURIComponent(fim)}&limit=500`);
    const cheios = validos.filter(v => doDia.filter(a => (a.destinos || []).includes(v.id)).length >= limite);
    if (cheios.length && !b.forcar) return send(res, 409, { erro: `${cheios.map(c => c.nome).join(', ')} já tem ${limite} avisos nesse dia.`, cheios: cheios.map(c => c.id), pode_forcar: true });
    const a = await db.insert('sdb_wa_avisos', {
      titulo: txt(b.titulo, 120) || texto.split('\n')[0].replace(/[*_~]/g, '').slice(0, 80), copy_id: txt(b.copy_id, 40) || null,
      texto, imagem_url: imagem_url || null, destinos: pedidos, agendar_em: quando.toISOString(), expira_em: null,
      status: 'agendado', total: pedidos.length, enviados: 0, falhas: 0, origem: 'painel',
    });
    return send(res, 200, { ok: true, aviso: a });
  }

  if (acao === 'wa_cancelar') {
    const id = Number(b.id);
    if (!Number.isInteger(id)) throw fail(400, 'Aviso inválido');
    await db.update('sdb_wa_avisos', `id=eq.${id}&status=in.(agendado,enviando)`, { status: 'cancelado', atualizado_em: agoraIso() });
    return send(res, 200, { ok: true });
  }

  if (acao === 'wa_envios') {
    const id = Number(new URL(req.url, 'http://x').searchParams.get('id') || b.id);
    if (!Number.isInteger(id)) throw fail(400, 'Aviso inválido');
    return send(res, 200, { envios: await todos('sdb_wa_aviso_envios', `select=*&aviso_id=eq.${id}&order=enviado_em.asc`) });
  }

  if (acao === 'wa_semana') {
    const turma = /^\d{4}-\d{2}-\d{2}$/.test(b.turma || '') ? b.turma : segundaDa(agora());
    return send(res, 200, { ok: true, turma, ...(await garantirCalendario(turma, { folgaMs: 0 })) });
  }
  return send(res, 400, { erro: 'Ação inválida' });
}

const EXT = new Set(['wa_sync', 'wa_fila', 'wa_resultado', 'wa_resumo']);
const PAINEL = new Set(['wa_painel', 'wa_destino', 'wa_criar', 'wa_cancelar', 'wa_envios', 'wa_semana']);

module.exports = { EXT, PAINEL, extensao, painel, garantirCalendario, CATEGORIAS, extOk, cfgSet };
