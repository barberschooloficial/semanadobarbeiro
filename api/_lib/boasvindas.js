// E-mail de boas-vindas: sai no cadastro e, se falhar (domínio do Resend sem verificar, chave errada...),
// o agendador tenta de novo a cada 5 minutos para quem se cadastrou nos últimos 7 dias.
const { db, config, logEvento } = require('./db');
const { APP_URL, SITE_URL } = require('./http');
const mailer = require('./email');
const { COPIES, ajustar } = require('./copies');
const { turmaDo, janela, textoLives } = require('./turma');
const { agora } = require('./util');

const MODULOS = [
  'Corte Mid Fade com Pompadour e Dicas sobre tesouras',
  'Equipamentos básicos do barbeiro e Tudo sobre pentes',
  'Como cortar cabelo com muito redemoinho e Corte Razor Part',
  'Barba passo a passo e Flat Top com High Fade',
  'High Fade em "V" atrás e Progressiva masculina',
];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dataBR = (ms) => { const d = new Date(ms - 3 * 3600e3); return `${DIAS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const foneBR = (n) => { const d = String(n || '').replace(/^55/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d; };

function vars(lead, cfg) {
  const j = janela(turmaDo(lead, cfg), cfg);
  const hora = (cfg.aula_hora || '08:00').replace(':00', 'h');
  return {
    nome: String(lead.nome || '').split(' ')[0],
    app_link: `${APP_URL()}/?t=${lead.token}`,
    whatsapp: foneBR(lead.whatsapp),
    email: lead.email,
    cronograma: MODULOS.map((m, i) => `**Módulo ${i + 1}** · ${dataBR(j.libera(i + 1))}, ${hora}: ${m}`).join('\n'),
    lives: textoLives(cfg),
    fim: dataBR(j.fim - 60e3),
    grupo_link: cfg.grupo_whatsapp_url || `${SITE_URL()}/obrigado`,
    suporte_link: `${SITE_URL()}/suporte`,
  };
}

async function enviar(lead, cfg) {
  cfg = cfg || await config();
  const c = ajustar(COPIES, cfg).find(x => x.id === 'email_boas_vindas');
  const v = vars(lead, cfg);
  const r = await mailer.enviarLote([{ ref: lead.id, para: lead.email, assunto: mailer.preencher(c.assunto, v), texto: mailer.preencher(c.texto, v), descadastro: `${SITE_URL()}/api/disparos?acao=descadastro&t=${lead.token}` }]);
  if (r.ok.length) await logEvento('email_boas_vindas', { lead_id: lead.id });
  // problema geral (chave, domínio, limite do Resend) não conta como falha do endereço
  else await logEvento(r.parar ? 'email_sistema_falha' : 'email_boas_vindas_falha', { lead_id: lead.id, payload: { erro: r.falhas[0]?.erro || 'falhou' } });
  return r;
}

// Reenvia para quem ficou sem (cadastrados há mais de 10 min e menos de 7 dias). No máximo 40 por rodada.
async function pendentes() {
  const cfg = await config();
  const de = new Date(agora() - 7 * 86400e3).toISOString(), ate = new Date(agora() - 10 * 60e3).toISOString();
  const leads = await db.select('sdb_leads', `select=*&created_at=gte.${encodeURIComponent(de)}&created_at=lte.${encodeURIComponent(ate)}&email_optout=is.false&order=created_at.asc&limit=500`).catch(() =>
    db.select('sdb_leads', `select=*&created_at=gte.${encodeURIComponent(de)}&created_at=lte.${encodeURIComponent(ate)}&order=created_at.asc&limit=500`));
  if (!leads.length) return 0;
  const ok = new Set(), falhas = {};
  for (let i = 0; i < leads.length; i += 100) {
    const ids = leads.slice(i, i + 100).map(l => l.id);
    (await db.select('sdb_eventos', `select=lead_id,tipo&tipo=in.(email_boas_vindas,email_boas_vindas_falha)&lead_id=in.(${ids.join(',')})`)).forEach(e => {
      if (e.tipo === 'email_boas_vindas') ok.add(e.lead_id); else falhas[e.lead_id] = (falhas[e.lead_id] || 0) + 1;
    });
  }
  // e-mail que falhou 6 vezes (endereço recusado pelo Resend, por exemplo) sai da fila
  leads.forEach(l => { if ((falhas[l.id] || 0) >= 6) ok.add(l.id); });
  let n = 0;
  for (const l of leads.filter(l => !ok.has(l.id) && l.email).slice(0, 40)) {
    const r = await enviar(l, cfg).catch(() => null);
    if (r?.parar) break; // chave/domínio com problema: para e tenta na próxima rodada
    if (r?.ok?.length) n++;
  }
  return n;
}

module.exports = { enviar, pendentes, vars };
