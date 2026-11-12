// POST /api/lead — cadastro gratuito na Semana do Barbeiro
const { db, config, logEvento } = require('./_lib/db');
const { turmaParaCadastro, turmaDo, janela } = require('./_lib/turma');
const { readJson, send, handler, fail, APP_URL, SITE_URL } = require('./_lib/http');
const mailer = require('./_lib/email');
const { COPIES, ajustar } = require('./_lib/copies');
const { limpaTexto, normalizaWhats, normalizaEmail } = require('./_lib/valida');
const manychat = require('./_lib/manychat');
const { comTimeout, agora } = require('./_lib/util');

module.exports = handler(['POST'], async (req, res) => {
  const b = await readJson(req);
  if (b.site) return send(res, 200, { ok: true }); // honeypot anti-robô

  const nome = limpaTexto(b.nome, 80);
  const whatsapp = normalizaWhats(b.whatsapp);
  const email = normalizaEmail(b.email);
  if (nome.length < 2) throw fail(400, 'Digite seu nome.');
  if (!whatsapp) throw fail(400, 'WhatsApp inválido. Use DDD + número.');
  if (!email) throw fail(400, 'E-mail inválido.');
  if (!b.lgpd) throw fail(400, 'Marque a autorização para receber as aulas.');

  const utm = (k) => limpaTexto(b[k], 100) || null;
  const cfg = await config();
  const t = agora();
  // Mesmo WhatsApp ou mesmo e-mail = mesma pessoa
  let lead = await db.one('sdb_leads', `whatsapp=eq.${whatsapp}&select=*`) || await db.one('sdb_leads', `email=eq.${encodeURIComponent(email)}&select=*`);
  let novo = false;
  if (lead) {
    // Quem já passou por uma Semana não entra numa turma nova
    const j = janela(turmaDo(lead, cfg), cfg);
    if (t > j.fim) {
      await logEvento('cadastro_repetido', { lead_id: lead.id, payload: { utm_source: utm('utm_source'), utm_campaign: utm('utm_campaign') } });
      return send(res, 200, { ok: false, ja_participou: true, nome: lead.nome.split(' ')[0], comprou: lead.curso_status === 'pago', curso_url: cfg.curso_site_url || 'https://www.barberschool.com.br' });
    }
    // Já cadastrado na turma atual ou na próxima: mantém os dados originais (não deixa terceiros trocarem nome/e-mail)
    if (!lead.lgpd_consent) [lead] = await db.update('sdb_leads', `id=eq.${lead.id}`, { lgpd_consent: true });
  } else {
    lead = await db.insert('sdb_leads', {
      nome, whatsapp, email, lgpd_consent: true, turma_inicio: turmaParaCadastro(t, cfg.inscricao_ate),
      utm_source: utm('utm_source'), utm_medium: utm('utm_medium'),
      utm_campaign: utm('utm_campaign'), utm_content: utm('utm_content'),
      origem: utm('origem') || 'site',
    });
    novo = true;
    // Veio de um convite (link com ?c=): liga o contato da lista ao cadastro
    if (/^[a-f0-9]{16,40}$/.test(String(b.contato || ''))) await db.update('sdb_contatos', `token=eq.${b.contato}`, { lead_id: lead.id }).catch(() => {});
  }

  const app_link = `${APP_URL()}/?t=${lead.token}`;
  const mcId = await comTimeout(manychat.sync(lead, { tags: ['sdb_cadastro'], campos: { app_link } }), 4000);
  if (mcId && mcId !== lead.manychat_id) await db.update('sdb_leads', `id=eq.${lead.id}`, { manychat_id: mcId });
  if (novo) {
    await logEvento('cadastro', { lead_id: lead.id, payload: { origem: lead.origem, utm_source: lead.utm_source, utm_campaign: lead.utm_campaign, turma: lead.turma_inicio } });
    // E-mail de boas-vindas (biblioteca: api/_lib/copies.js → email_boas_vindas). Se falhar, o agendador reenvia.
    await comTimeout(require('./_lib/boasvindas').enviar(lead, cfg), 5000);
  }

  send(res, 200, { ok: true, token: lead.token, app_link, novo, turma: turmaDo(lead, cfg) });
});
