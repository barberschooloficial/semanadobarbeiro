// Boas-vindas no privado: quando alguém entra num grupo/comunidade da Semana (categoria "semana"),
// a extensão avisa aqui (wa_entrou), a mensagem entra numa fila (sdb_wa_dm) e sai pela própria extensão,
// uma por vez, no horário permitido e dentro do limite diário. Assinada pela Bia, do suporte.
// O texto é montado na hora do envio, com o cadastro (enquete) e a situação do certificado.
const { db, config, logEvento } = require('./db');
const { APP_URL, SITE_URL } = require('./http');
const { agora } = require('./util');
const { turmaDo, janela } = require('./turma');
const { COPIES_GRUPO } = require('./copies-grupo');
const { ajustar } = require('./copies');
const { precoCert } = require('./cert-preco');

const ID_GRUPO = /^[0-9-]{5,40}@g\.us$/;
const ID_PESSOA = /^\d{5,20}@(c\.us|lid|s\.whatsapp\.net)$/;
const agoraIso = () => new Date(agora()).toISOString();
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// 55 + DDD + número, com e sem o 9 (o WhatsApp às vezes guarda o celular sem o 9)
function variantes(pn) {
  const d = String(pn || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(d)) return [];
  const ddd = d.slice(2, 4), num = d.slice(4);
  return [...new Set([d, num.length === 8 ? `55${ddd}9${num}` : null, num.length === 9 && num[0] === '9' ? `55${ddd}${num.slice(1)}` : null].filter(Boolean))];
}

// Suporte da Barber School (dúvidas do curso completo). Vazio no painel = 5551926366047; escreva "-" para não usar.
const suporteBS = (cfg) => String(cfg.wa_suporte_barberschool || '5551926366047').replace(/\D/g, '');
// Números que a Bia nunca responde nem chama (Configurações: wa_ignorar; o suporte da Barber School já entra)
const ignorados = (cfg) => new Set([suporteBS(cfg), ...String(cfg.wa_ignorar || '').split(/[\s,;]+/)]
  .flatMap(n => variantes(String(n || '').replace(/\D/g, ''))));

// Hora de Brasília em minutos desde 00:00
const minutosBR = (ms) => { const d = new Date(ms - 3 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (s, pad) => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : pad; };

// Joga o horário para dentro da janela permitida (ex.: 08:00–21:00). Fora dela, vai para a próxima abertura.
function dentroDoHorario(ms, cfg) {
  const ini = hm(cfg.wa_bv_inicio, 8 * 60), fim = hm(cfg.wa_bv_fim, 21 * 60), m = minutosBR(ms);
  if (m >= ini && m < fim) return ms;
  const dia = ms - m * 60e3 - (ms % 60e3); // 00:00 de Brasília do mesmo dia
  const abre = m < ini ? dia + ini * 60e3 : dia + 864e5 + ini * 60e3;
  return abre + Math.round(Math.random() * 20 * 60e3); // até 20 min depois da abertura, para não sair tudo junto
}

async function entrou(b) {
  const cfg = await config();
  if (cfg.wa_bv_ativo === '0') return { ok: true, desligado: true };
  const grupo = txt(b.grupo_id, 60);
  if (!ID_GRUPO.test(grupo)) return { ok: false, erro: 'grupo inválido' };
  // Só grupos da Semana: o próprio grupo ou o grupo de avisos de uma comunidade marcada como "Semana do Barbeiro"
  const g = encodeURIComponent(grupo);
  const destino = await db.one('sdb_wa_destinos', `select=id,nome&categoria=eq.semana&id=eq.${g}`)
    || await db.one('sdb_wa_destinos', `select=id,nome&categoria=eq.semana&envio_id=eq.${g}`);
  if (!destino) return { ok: true, ignorado: 'grupo fora da Semana' };
  const meu = String(cfg.wa_ext_numero || '');
  const lista = Array.isArray(b.participantes) ? b.participantes.slice(0, 50) : [];
  const ign = ignorados(cfg);
  let n = 0;
  // fila: espaça cada mensagem depois da última que ainda vai sair
  const ultima = await db.one('sdb_wa_dm', 'select=agendar_em&status=eq.pendente&order=agendar_em.desc');
  let base = Math.max(agora() + (60 + Math.random() * 120) * 1e3, ultima ? Date.parse(ultima.agendar_em) + (45 + Math.random() * 75) * 1e3 : 0);
  for (const p of lista) {
    const id = txt(p.id, 60);
    if (!ID_PESSOA.test(id)) continue;
    const pn = variantes(p.pn || (id.endsWith('@c.us') ? id.split('@')[0] : ''))[0] || null;
    if (pn && meu && variantes(meu).includes(pn)) continue; // o próprio número de avisos
    if (pn && ign.has(pn)) continue; // suporte da Barber School e outros números da equipe
    const lead = pn ? await db.one('sdb_leads', `select=id&whatsapp=in.(${variantes(pn).join(',')})&order=created_at.desc`) : null;
    // uma boas-vindas por pessoa, para sempre (sair e voltar não repete)
    const chave = `bv:${pn || id}`;
    try {
      await db.insert('sdb_wa_dm', {
        chave, tipo: 'bv', grupo_id: grupo, para: pn ? `${pn}@c.us` : id, pn, lead_id: lead?.id || null,
        nome_wa: txt(p.nome, 60) || null, status: 'pendente', agendar_em: new Date(dentroDoHorario(base, cfg)).toISOString(),
      });
      n++;
      base += (45 + Math.random() * 75) * 1e3;
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  if (n) await logEvento('wa_bv_fila', { payload: { grupo: destino.nome, novos: n } }).catch(() => {});
  return { ok: true, na_fila: n };
}

// Alguém mandou "SEMANA - quero receber as aulas" no privado do número de avisos (botão da página de obrigado).
// A Bia responde em seguida com o acesso, o grupo e o certificado. Uma resposta por pessoa por dia.
async function palavra(b) {
  const cfg = await config();
  if (cfg.wa_bv_ativo === '0' || cfg.wa_palavra_ativo === '0') return { ok: true, desligado: true };
  const id = txt(b.de, 60);
  if (!ID_PESSOA.test(id)) return { ok: false, erro: 'remetente inválido' };
  const pn = variantes(b.pn || (id.endsWith('@c.us') ? id.split('@')[0] : ''))[0] || null;
  const meu = String(cfg.wa_ext_numero || '');
  if (pn && meu && variantes(meu).includes(pn)) return { ok: true, ignorado: 'próprio número' };
  if (pn && ignorados(cfg).has(pn)) return { ok: true, ignorado: 'número na lista de ignorados' };
  const lead = pn ? await db.one('sdb_leads', `select=id&whatsapp=in.(${variantes(pn).join(',')})&order=created_at.desc`) : null;
  const dia = new Date(agora() - 3 * 3600e3).toISOString().slice(0, 10);
  try {
    await db.insert('sdb_wa_dm', {
      chave: `kw:${pn || id}:${dia}`, tipo: 'kw', grupo_id: null, para: pn ? `${pn}@c.us` : id, pn, lead_id: lead?.id || null,
      nome_wa: txt(b.nome, 60) || null, status: 'pendente', agendar_em: new Date(agora() + (10 + Math.random() * 20) * 1e3).toISOString(),
    });
  } catch (e) { if (e.code !== '23505') throw e; return { ok: true, ja_respondido: true }; }
  await logEvento('wa_palavra', { lead_id: lead?.id || null, payload: { pn, achou: !!lead } }).catch(() => {});
  return { ok: true, na_fila: 1, achou: !!lead };
}

// Lembrete do certificado: 5 min depois de gerar a cobrança, se ainda não pagou, a Bia chama no WhatsApp.
// Fora do horário permitido vai para a próxima abertura (e só sai se a cobrança ainda estiver em aberto).
async function lembreteCert(lead, paymentId) {
  const cfg = await config();
  if (cfg.wa_bv_ativo === '0' || cfg.cert_lembrete_ativo === '0' || !lead?.whatsapp || !paymentId) return null;
  // no máximo 2 lembretes por pessoa (cada cobrança nova poderia gerar outro)
  const ja = await db.select('sdb_wa_dm', `select=id&tipo=eq.cert&lead_id=eq.${lead.id}&limit=2`).catch(() => []);
  if (ja.length >= 2) return null;
  const min = Number(cfg.cert_lembrete_min || 5);
  try {
    return await db.insert('sdb_wa_dm', {
      chave: `cert:${paymentId}`, tipo: 'cert', grupo_id: null, para: `${lead.whatsapp}@c.us`, pn: lead.whatsapp, lead_id: lead.id,
      status: 'pendente', agendar_em: new Date(dentroDoHorario(agora() + min * 60e3, cfg)).toISOString(),
    });
  } catch (e) { if (e.code !== '23505') throw e; return null; }
}

// Primeiro nome legível: do cadastro ou do nome do WhatsApp (só letras)
function primeiro(nome) {
  const n = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!/^[\p{L}'-]{2,20}$/u.test(n)) return '';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}
const linha = (c) => { const t = String(c?.texto || '').trim(); return t === '-' ? '' : t; };
const preencher = (t, v) => String(t).replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');

async function montar(dm, cfg) {
  const C = Object.fromEntries(ajustar(COPIES_GRUPO, cfg).filter(c => c.dm).map(c => [c.id, c]));
  const lead = dm.lead_id ? await db.one('sdb_leads', `select=*&id=eq.${dm.lead_id}`) : null;
  const v = { nome: primeiro(lead?.nome) || primeiro(dm.nome_wa) };
  if (lead) {
    const app = `${APP_URL()}/?t=${lead.token}`;
    v.cert_link = `${app}&comprar=certificado`;
    v.linha_perfil = linha(C[`g_dm_perfil_${lead.perfil}`]) || '';
    v.linha_acesso = `Seu acesso às aulas: ${app}`;
    // Certificado: preço das primeiras 24 h (com prazo) ou, depois delas, a última chance de 10 min (uma vez só)
    const p = await precoCert(lead, cfg);
    const reais = (n) => Number(n).toFixed(2).replace('.', ',');
    Object.assign(v, { cert_preco: reais(p.promo ? p.valor : Number(cfg.cert_preco || 19.7)), cert_cheio: reais(p.cheio), minutos: String(Number(cfg.cert_ultima_min || 10)), oferta_link: `${app}&comprar=certificado&oferta=1` });
    if (p.ate) { const a = new Date(p.ate - 3 * 3600e3), h = new Date(agora() - 3 * 3600e3); v.prazo = `${a.getUTCDate() === h.getUTCDate() ? 'hoje' : 'amanhã'} às ${a.getUTCHours()}h${String(a.getUTCMinutes()).padStart(2, '0')}`; }
    v.cert_valor = reais(Number(lead.cert_valor) || p.valor);
    v.linha_prazo = p.promo && v.prazo ? `Ele está de ~R$ ${v.cert_cheio}~ por *R$ ${v.cert_preco}* só até ${v.prazo}. Depois volta para R$ ${v.cert_cheio}.` : '';
    const jaUsou = p.fase === 'cheio' && await db.one('sdb_eventos', `select=id&tipo=eq.cert_uc_aberta&lead_id=eq.${lead.id}`).catch(() => null);
    const lembreteRecente = dm.tipo !== 'cert' && await db.one('sdb_wa_dm', `select=id&tipo=eq.cert&lead_id=eq.${lead.id}&status=eq.enviado&enviado_em=gte.${encodeURIComponent(new Date(agora() - 6 * 3600e3).toISOString())}`).catch(() => null);
    v.linha_certificado = lembreteRecente ? '' : lead.cert_status === 'pago' ? linha(C.g_dm_cert_pago)
      : p.fase === 'promo' ? linha(lead.cert_status === 'pendente' ? C.g_dm_cert_pendente : C.g_dm_cert_nao)
      : p.fase === 'cheio' && !jaUsou && p.cheio > Number(cfg.cert_preco || 19.7) ? linha(C.g_dm_cert_ultima) : '';
    // em que pé está a turma da pessoa
    const j = janela(turmaDo(lead, cfg), cfg), t = agora();
    if (t < j.libera(1)) { const d = new Date(j.libera(1) - 3 * 3600e3); v.linha_modulo = `As aulas começam ${DIAS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}, às ${(cfg.aula_hora || '08:00').replace(':00', 'h').replace(/^0/, '')}. O aviso de cada módulo chega no grupo.`; }
    else if (t <= j.fim) { let m = 1; for (let d = 2; d <= 5; d++) if (t >= j.libera(d)) m = d; v.linha_modulo = m === 1 ? 'O *Módulo 1* já está liberado: dá tempo de começar hoje.' : `Já estão liberados os módulos de 1 a ${m}. Dá para assistir no seu ritmo até domingo.`; }
  } else {
    v.linha_acesso = linha(C.g_dm_sem_cadastro);
  }
  const suporte = String(cfg.whatsapp_suporte || '').replace(/\D/g, ''), meu = String(cfg.wa_ext_numero || '');
  v.linha_suporte = suporte && meu && !variantes(meu).some(x => variantes(suporte).includes(x)) ? `é só me chamar no suporte: ${SITE_URL().replace(/^https?:\/\//, '')}/suporte` : 'é só me responder por aqui';
  // as linhas também podem ter variáveis ({{cert_link}}, {{cert_preco}}, {{nome}})
  for (const k of Object.keys(v)) if (k.startsWith('linha_')) v[k] = preencher(v[k], v);
  if (dm.tipo === 'kw') {
    v.linha_inscricao = lead ? 'Recebi sua mensagem e a sua inscrição está confirmada ✅' : 'Recebi sua mensagem!';
    const g = String(cfg.grupo_whatsapp_url || '').trim();
    v.linha_grupo = lead && /^https:\/\//.test(g) ? preencher(linha(C.g_dm_palavra_grupo), { grupo_link: g }) : '';
    v.linha_suporte = 'é só me responder por aqui';
    const bs = variantes(suporteBS(cfg))[0];
    v.linha_barberschool = bs ? preencher(linha(C.g_dm_palavra_bs), { bs_link: `https://wa.me/${bs}` }) : '';
  }
  const principal = dm.tipo === 'cert' ? C.g_dm_cert_lembrete : dm.tipo === 'kw' ? C.g_dm_palavra : C.g_dm_bv;
  let texto = preencher(linha(principal), v);
  if (!v.nome) texto = texto.replace(/^Oi, ?!/, 'Oi!'); // sem nome: "Oi! Tudo bem?"
  // linhas vazias somem sem deixar buraco
  return texto.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).join('\n\n').slice(0, 4000);
}

// Próxima mensagem para a extensão (no máximo 1 por chamada; a extensão espera entre uma e outra)
async function proximo() {
  const cfg = await config();
  if (cfg.wa_bv_ativo === '0') return null;
  const t = agora();
  const travado = new Date(t - 5 * 60e3).toISOString();
  const livre = (d) => !d.tentado_em || Date.parse(d.tentado_em) < Date.parse(travado); // a que está saindo agora não volta
  // 1º: resposta a quem mandou "SEMANA" no privado (a pessoa chamou: sai a qualquer hora e fora do limite diário)
  const kw = (await db.select('sdb_wa_dm', `select=*&tipo=eq.kw&status=eq.pendente&agendar_em=lte.${encodeURIComponent(agoraIso())}&order=agendar_em.asc&limit=5`)).filter(livre)[0];
  if (kw) {
    if (t - Date.parse(kw.created_at) > 864e5) { await db.update('sdb_wa_dm', `id=eq.${kw.id}`, { status: 'expirado' }); return null; }
    const texto = await montar(kw, cfg);
    await db.update('sdb_wa_dm', `id=eq.${kw.id}`, { tentado_em: agoraIso(), tentativas: (kw.tentativas || 0) + 1, texto });
    return { id: kw.id, para: kw.para, texto };
  }
  if (dentroDoHorario(t, cfg) !== t) return null;
  const limite = Number(cfg.wa_bv_limite_dia || 60);
  const hoje = new Date(t - 3 * 3600e3).toISOString().slice(0, 10);
  const enviadosHoje = await db.select('sdb_wa_dm', `select=id&tipo=neq.kw&status=eq.enviado&enviado_em=gte.${encodeURIComponent(new Date(`${hoje}T00:00:00-03:00`).toISOString())}&limit=${limite}`);
  if (enviadosHoje.length >= limite) return null;
  const fila = (await db.select('sdb_wa_dm', `select=*&status=eq.pendente&tipo=neq.kw&agendar_em=lte.${encodeURIComponent(agoraIso())}&order=agendar_em.asc&limit=10`))
    .filter(livre);
  let dm = null;
  for (const d of fila) {
    if (d.tipo === 'cert') {
      // lembrete do certificado: só se aquela cobrança continua em aberto (pagou, expirou ou trocou: descarta)
      const l = d.lead_id ? await db.one('sdb_leads', `select=cert_status,cert_payment_id&id=eq.${d.lead_id}`) : null;
      if (!l || l.cert_status !== 'pendente' || `cert:${l.cert_payment_id}` !== d.chave) { await db.update('sdb_wa_dm', `id=eq.${d.id}`, { status: 'cancelado', erro: 'pagou ou a cobrança mudou' }); continue; }
      // a boas-vindas da Bia já falou do certificado há pouco: não manda as duas
      const bv = await db.one('sdb_wa_dm', `select=id&tipo=in.(bv,kw)&lead_id=eq.${d.lead_id}&status=eq.enviado&enviado_em=gte.${encodeURIComponent(new Date(t - 6 * 3600e3).toISOString())}`).catch(() => null);
      if (bv) { await db.update('sdb_wa_dm', `id=eq.${d.id}`, { status: 'cancelado', erro: 'boas-vindas recente já falou do certificado' }); continue; }
    }
    if (d.tipo === 'bv' && d.pn) {
      const kw = await db.one('sdb_wa_dm', `select=id&tipo=eq.kw&pn=eq.${d.pn}&status=eq.enviado&enviado_em=gte.${encodeURIComponent(new Date(t - 864e5).toISOString())}`).catch(() => null);
      if (kw) { await db.update('sdb_wa_dm', `id=eq.${d.id}`, { status: 'cancelado', erro: 'a Bia já respondeu o pedido de aulas no privado' }); continue; }
    }
    dm = d; break;
  }
  if (!dm) return null;
  // passou de 2 dias na fila (computador desligado): a boas-vindas perde o sentido
  if (t - Date.parse(dm.created_at) > 2 * 864e5) { await db.update('sdb_wa_dm', `id=eq.${dm.id}`, { status: 'expirado' }); return null; }
  const texto = await montar(dm, cfg);
  await db.update('sdb_wa_dm', `id=eq.${dm.id}`, { tentado_em: agoraIso(), tentativas: (dm.tentativas || 0) + 1, texto });
  return { id: dm.id, para: dm.para, texto };
}

async function resultado(b) {
  const id = Number(b.id);
  if (!Number.isInteger(id)) return { ok: false };
  const dm = await db.one('sdb_wa_dm', `select=id,tentativas,status,lead_id,texto&id=eq.${id}`);
  if (!dm || dm.status !== 'pendente') return { ok: true };
  if (b.ok) {
    await db.update('sdb_wa_dm', `id=eq.${id}`, { status: 'enviado', enviado_em: agoraIso(), erro: null, msg_id: txt(b.msg_id, 120) || null });
    // a mensagem levou o link da última chance do certificado: o link passa a valer (10 min contados quando abrir)
    if (dm.lead_id && /[?&]oferta=1/.test(dm.texto || '')) await logEvento('cert_uc_liberada', { lead_id: dm.lead_id, chave: `cert_uc_liberada:${dm.lead_id}` });
  }
  else await db.update('sdb_wa_dm', `id=eq.${id}`, { status: (dm.tentativas || 0) >= 3 ? 'falha' : 'pendente', erro: txt(b.erro || 'erro', 200) });
  return { ok: true };
}

async function resumo() {
  const cfg = await config();
  const hoje = new Date(agora() - 3 * 3600e3).toISOString().slice(0, 10);
  const desde = new Date(`${hoje}T00:00:00-03:00`).toISOString();
  const [env, fila, ult] = await Promise.all([
    db.select('sdb_wa_dm', `select=id&status=eq.enviado&enviado_em=gte.${encodeURIComponent(desde)}&limit=1000`),
    db.select('sdb_wa_dm', 'select=id&status=eq.pendente&limit=1000'),
    db.select('sdb_wa_dm', 'select=pn,nome_wa,tipo,status,erro,enviado_em,created_at&order=id.desc&limit=4'),
  ]).catch(() => [[], [], []]);
  return {
    ativo: cfg.wa_bv_ativo !== '0', hoje: env.length, fila: fila.length, limite: Number(cfg.wa_bv_limite_dia || 60),
    horario: `${cfg.wa_bv_inicio || '08:00'}–${cfg.wa_bv_fim || '21:00'}`,
    ultimos: ult.map(u => ({ quem: (u.tipo === 'cert' ? 'lembrete certificado · ' : u.tipo === 'kw' ? 'pediu as aulas · ' : '') + (u.nome_wa || (u.pn ? `+${u.pn}` : 'contato')), status: u.status, erro: u.erro, em: u.enviado_em || u.created_at })),
  };
}

module.exports = { entrou, palavra, proximo, resultado, resumo, montar, variantes, dentroDoHorario, lembreteCert };
