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
  let n = 0;
  // fila: espaça cada mensagem depois da última que ainda vai sair
  const ultima = await db.one('sdb_wa_dm', 'select=agendar_em&status=eq.pendente&order=agendar_em.desc');
  let base = Math.max(agora() + (60 + Math.random() * 120) * 1e3, ultima ? Date.parse(ultima.agendar_em) + (45 + Math.random() * 75) * 1e3 : 0);
  for (const p of lista) {
    const id = txt(p.id, 60);
    if (!ID_PESSOA.test(id)) continue;
    const pn = variantes(p.pn || (id.endsWith('@c.us') ? id.split('@')[0] : ''))[0] || null;
    if (pn && meu && variantes(meu).includes(pn)) continue; // o próprio número de avisos
    const lead = pn ? await db.one('sdb_leads', `select=id&whatsapp=in.(${variantes(pn).join(',')})&order=created_at.desc`) : null;
    // uma boas-vindas por pessoa, para sempre (sair e voltar não repete)
    const chave = `bv:${pn || id}`;
    try {
      await db.insert('sdb_wa_dm', {
        chave, grupo_id: grupo, para: pn ? `${pn}@c.us` : id, pn, lead_id: lead?.id || null,
        nome_wa: txt(p.nome, 60) || null, status: 'pendente', agendar_em: new Date(dentroDoHorario(base, cfg)).toISOString(),
      });
      n++;
      base += (45 + Math.random() * 75) * 1e3;
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  if (n) await logEvento('wa_bv_fila', { payload: { grupo: destino.nome, novos: n } }).catch(() => {});
  return { ok: true, na_fila: n };
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
    const jaUsou = p.fase === 'cheio' && await db.one('sdb_eventos', `select=id&tipo=eq.cert_uc_aberta&lead_id=eq.${lead.id}`).catch(() => null);
    v.linha_certificado = lead.cert_status === 'pago' ? linha(C.g_dm_cert_pago)
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
  let texto = preencher(linha(C.g_dm_bv), v);
  if (!v.nome) texto = texto.replace(/^Oi, ?!/, 'Oi!'); // sem nome: "Oi! Tudo bem?"
  // linhas vazias somem sem deixar buraco
  return texto.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).join('\n\n').slice(0, 4000);
}

// Próxima mensagem para a extensão (no máximo 1 por chamada; a extensão espera entre uma e outra)
async function proximo() {
  const cfg = await config();
  if (cfg.wa_bv_ativo === '0') return null;
  const t = agora();
  if (dentroDoHorario(t, cfg) !== t) return null;
  const limite = Number(cfg.wa_bv_limite_dia || 60);
  const hoje = new Date(t - 3 * 3600e3).toISOString().slice(0, 10);
  const enviadosHoje = await db.select('sdb_wa_dm', `select=id&status=eq.enviado&enviado_em=gte.${encodeURIComponent(new Date(`${hoje}T00:00:00-03:00`).toISOString())}&limit=${limite}`);
  if (enviadosHoje.length >= limite) return null;
  const travado = new Date(t - 5 * 60e3).toISOString();
  // a que está sendo enviada agora (tentada há menos de 5 min) não volta para a fila
  const dm = (await db.select('sdb_wa_dm', `select=*&status=eq.pendente&agendar_em=lte.${encodeURIComponent(agoraIso())}&order=agendar_em.asc&limit=10`))
    .find(d => !d.tentado_em || Date.parse(d.tentado_em) < Date.parse(travado));
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
    db.select('sdb_wa_dm', 'select=pn,nome_wa,status,erro,enviado_em,created_at&order=id.desc&limit=4'),
  ]).catch(() => [[], [], []]);
  return {
    ativo: cfg.wa_bv_ativo !== '0', hoje: env.length, fila: fila.length, limite: Number(cfg.wa_bv_limite_dia || 60),
    horario: `${cfg.wa_bv_inicio || '08:00'}–${cfg.wa_bv_fim || '21:00'}`,
    ultimos: ult.map(u => ({ quem: u.nome_wa || (u.pn ? `+${u.pn}` : 'contato'), status: u.status, erro: u.erro, em: u.enviado_em || u.created_at })),
  };
}

module.exports = { entrou, proximo, resultado, resumo, montar, variantes, dentroDoHorario };
