// Convites automáticos para as listas da aba Leads (base antiga, barbearias do Google Maps, importações).
// Roda no agendador (a cada 5 min), sem ninguém mexer no painel:
//  1. reenvio para quem não abriu, N dias depois do convite de cada bloco (só listas de pessoas);
//  2. convite para o bloco que ainda tem gente sem convite;
//  3. sem bloco pendente: monta o próximo bloco com quem ainda não tem bloco e convida.
// Um convite por e-mail por vez. O ritmo fica com a cota diária (aquecimento + limite do plano do Resend),
// então o bloco vai saindo ao longo dos dias sozinho.
// WhatsApp: só pela API (ManyChat, template aprovado) e só para quem abriu ou clicou no e-mail, com teto diário.
const { db, logEvento } = require('./db');
const C = require('./contatos');
const { COPIES, ajustar } = require('./copies');
const { agora } = require('./util');

const DIA = 864e5;
const MAPS = 'barbearias_maps';
const minutosBR = (ms) => { const d = new Date(ms - 3 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (s, pad) => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : pad; };
const ddmm = (ms) => { const d = new Date(ms - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const CONVITES = new Set(['convite_semana_email', 'convite_barbearia_maps']);

function opcoes(cfg) {
  return {
    ativo: cfg.conv_auto_ativo === '1',
    listas: String(cfg.conv_auto_listas || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
    bloco: Math.min(5000, Math.max(20, Number(cfg.conv_auto_bloco || 100))),
    reenvioDias: Math.max(0, Number(cfg.conv_auto_reenvio_dias ?? 3)),
    ini: hm(cfg.conv_auto_inicio, 8 * 60), fim: hm(cfg.conv_auto_fim, 20 * 60),
    wa: cfg.conv_auto_wa === '1' && !!String(cfg.mc_flow_convite || '').trim(),
  };
}

async function marcar(chave, valor) { await db.upsert('sdb_config', { chave, valor: String(valor) }, 'chave'); }

async function criar(copy, filtro, titulo, extra = {}) {
  const d = await db.insert('sdb_disparos', {
    canal: copy.canal, titulo: titulo.slice(0, 120), copy_id: copy.id, publico: 'contatos', link_tipo: copy.link_tipo || 'semana',
    filtro, assunto: copy.assunto || null, texto: copy.texto || null, flow_ns: extra.flow_ns || null,
    agendar_em: new Date(agora()).toISOString(), status: 'agendado', total: 0, enviados: 0, falhas: 0,
  });
  await logEvento('conv_auto', { payload: { disparo: d?.id, copy: copy.id, bloco: filtro.bloco, lista: filtro.lista } }).catch(() => {});
  return d;
}

// cotaEmail: quantos convites por e-mail ainda podem sair hoje (calculada em disparos.js)
async function rodar(cfg, cotaEmail) {
  const o = opcoes(cfg);
  if (!o.ativo) return { pulado: 'desligado' };
  const t = agora(), m = minutosBR(t);
  if (m < o.ini || m >= o.fim) return { pulado: 'fora do horário' };
  // sem nada para fazer da última vez: confere de novo só a cada 30 min (a lista inteira é pesada)
  if (t - (Date.parse(cfg.conv_auto_vazio || '') || 0) < 30 * 60e3) return { pulado: 'nada pendente há pouco' };

  const disparos = await db.select('sdb_disparos', 'select=id,canal,copy_id,filtro,status,atualizado_em,agendar_em&publico=eq.contatos&status=neq.cancelado&order=id.asc&limit=2000');
  const ativos = disparos.filter(d => ['agendado', 'enviando'].includes(d.status));
  const precisaEmail = cotaEmail > 0 && !ativos.some(d => d.canal === 'email');
  const precisaWa = o.wa && !ativos.some(d => d.canal === 'whatsapp');
  if (!precisaEmail && !precisaWa) return { pulado: cotaEmail > 0 ? 'convite em andamento' : 'cota de hoje usada' };

  const copies = Object.fromEntries(ajustar(COPIES, cfg).map(c => [c.id, c]));
  const todos = await C.carregar(db);
  const cs = o.listas.length ? todos.filter(c => o.listas.includes(c.lista)) : todos;
  const porBloco = {};
  cs.forEach(c => { if (c.bloco) (porBloco[`${c.lista}|${c.bloco}`] = porBloco[`${c.lista}|${c.bloco}`] || []).push(c); });
  const doBloco = (copyIds, lista, bloco) => disparos.filter(d => copyIds.includes(d.copy_id) && d.filtro?.lista === lista && d.filtro?.bloco === bloco);
  const fim = (ds) => Math.max(0, ...ds.filter(d => d.status === 'concluido' || d.status === 'erro').map(d => Date.parse(d.atualizado_em || d.agendar_em) || 0));
  const feito = [];

  if (precisaEmail) {
    let criado = null;
    // 1) reenvio para quem não abriu (bloco com convite concluído há N dias e sem reenvio ainda)
    if (o.reenvioDias > 0) {
      for (const [k, gente] of Object.entries(porBloco)) {
        const [lista, bloco] = k.split('|');
        if (lista === MAPS) continue; // empresa: um convite só
        const conv = doBloco([...CONVITES], lista, bloco);
        if (!conv.length || conv.some(d => ['agendado', 'enviando'].includes(d.status))) continue;
        if (doBloco(['convite_semana_reenvio'], lista, bloco).length) continue;
        if (t - fim(conv) < o.reenvioDias * DIA || !fim(conv)) continue;
        if (!C.aptos(C.filtrar(gente, { eng: 'nao_abriu' }), 'email').length) continue;
        criado = await criar(copies.convite_semana_reenvio, { lista, bloco, eng: 'nao_abriu' }, `Reenvio automático · ${bloco}`);
        feito.push(`reenvio ${bloco}`); break;
      }
    }
    // 2) bloco que ainda tem gente sem convite (ex.: parou na cota do dia)
    if (!criado) {
      for (const [k, gente] of Object.entries(porBloco).sort((a, b) => a[0].localeCompare(b[0]))) {
        const [lista, bloco] = k.split('|');
        if (!C.aptos(C.filtrar(gente, { eng: 'nao_convidado' }), 'email').length) continue;
        if (doBloco([...CONVITES], lista, bloco).filter(d => d.status === 'concluido').length >= 2) continue; // quem sobrou falhou 2 vezes
        const copy = copies[lista === MAPS ? 'convite_barbearia_maps' : 'convite_semana_email'];
        criado = await criar(copy, { lista, bloco, eng: 'nao_convidado' }, `Convite automático · ${bloco}`);
        feito.push(`convite ${bloco}`); break;
      }
    }
    // 3) monta o próximo bloco com quem ainda não tem bloco
    if (!criado) {
      const soltos = C.aptos(cs.filter(c => !c.bloco && !c.convites && !c.lead_id), 'email');
      if (soltos.length) {
        const lista = [...new Set(soltos.map(c => c.lista))].sort()[0];
        const n = 1 + Math.max(0, ...todos.map(c => Number(/^B(\d+)/.exec(c.bloco || '')?.[1] || 0)));
        const nome = `B${String(n).padStart(2, '0')} · ${lista === MAPS ? 'Maps' : lista} · ${ddmm(t)}`;
        const ids = soltos.filter(c => c.lista === lista).slice(0, o.bloco).map(c => c.id);
        for (let i = 0; i < ids.length; i += 200) await db.update('sdb_contatos', `id=in.(${ids.slice(i, i + 200).join(',')})`, { bloco: nome });
        const copy = copies[lista === MAPS ? 'convite_barbearia_maps' : 'convite_semana_email'];
        criado = await criar(copy, { lista, bloco: nome, eng: 'nao_convidado' }, `Convite automático · ${nome}`);
        feito.push(`bloco novo ${nome} (${ids.length})`);
      }
    }
  }

  // WhatsApp pela API: quem abriu ou clicou no e-mail do bloco, 1 dia depois do convite
  if (precisaWa) {
    for (const [k, gente] of Object.entries(porBloco).sort((a, b) => a[0].localeCompare(b[0]))) {
      const [lista, bloco] = k.split('|');
      const conv = doBloco([...CONVITES, 'convite_semana_reenvio'], lista, bloco);
      if (!fim(conv) || t - fim(conv) < DIA) continue;
      if (doBloco(['convite_semana_wa'], lista, bloco).length) continue;
      if (!C.aptos(C.filtrar(gente, { eng: 'abriu_ou_clicou' }), 'whatsapp').length) continue;
      await criar(copies.convite_semana_wa, { lista, bloco, eng: 'abriu_ou_clicou' }, `WhatsApp automático · ${bloco}`, { flow_ns: String(cfg.mc_flow_convite).trim() });
      feito.push(`whatsapp ${bloco}`); break;
    }
  }

  if (precisaEmail && !feito.some(f => !f.startsWith('whatsapp'))) await marcar('conv_auto_vazio', new Date(t).toISOString());
  return { feito };
}

module.exports = { rodar, opcoes };
