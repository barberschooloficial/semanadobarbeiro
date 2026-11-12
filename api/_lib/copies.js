// Biblioteca de copies e calendário de disparos da semana (base: COPIES.md).
// dia = dias depois da segunda-feira da turma; -1 = domingo antes.
// E-mail: {{nome}} = primeiro nome, {{app_link}} = link pessoal do app.
// WhatsApp: o texto fica no template aprovado dentro de um fluxo do ManyChat; aqui vai a chave de
// sdb_config que guarda o ID do fluxo (flow_ns) e um resumo para você conferir.

const BTN = '[Assistir agora]({{app_link}})';

const MODULOS = [
  ['Módulo 1 liberado: Mid Fade com Pompadour', 'O degradê médio passo a passo e as dicas do professor Cris Aita sobre tesouras: como escolher, usar e cuidar.'],
  ['Módulo 2: comece pela bancada', 'O que você precisa ter na bancada e qual pente usar em cada etapa do corte.'],
  ['O corte que todo mundo erra (redemoinho)', 'A dica que resolve o redemoinho sem estragar o corte e a risca na navalha com segurança, no Corte Razor Part.'],
  ['Barba passo a passo + Flat Top', 'Preparação, toalha quente, desenho e acabamento da barba. E o Flat Top com High Fade.'],
  ['Último módulo (e uma surpresa)', 'High Fade em "V" atrás e a progressiva masculina, o serviço que aumenta o ticket da cadeira.'],
];

const COPIES = [
  { id: 'email_boas_vindas', canal: 'email', titulo: 'Logo após o cadastro (automático)', automatico: true,
    assunto: 'Sua vaga está confirmada, {{nome}}: veja como acessar as aulas',
    texto: `Olá, {{nome}}! Aqui é o professor Cris Aita, criador da Barber School.

Sua vaga na **Semana do Barbeiro** está confirmada. São 10 aulas completas do meu curso, de graça: um módulo por dia, direto no celular.

**Seu acesso às aulas**
Toque no botão abaixo. Se pedir login, entre com o WhatsApp **{{whatsapp}}** e o e-mail **{{email}}**, os mesmos do cadastro.

[Abrir minhas aulas]({{app_link}})

**Cronograma da sua turma**
{{cronograma}}

As aulas ficam no ar até {{fim}}, às 23h59. Antes da primeira aula de cada dia você gira a roleta e pode ganhar prêmios.

**Lives comigo no Instagram:** {{lives}}, no @barberschooloficial. Traga suas dúvidas!

**Entre no grupo de avisos da turma**
É por lá que eu aviso cada módulo liberado:
[Entrar no grupo do WhatsApp]({{grupo_link}})

**Precisa de ajuda?** Fale com o nosso suporte no WhatsApp: {{suporte_link}}

Um conselho que eu sempre dou: **não parem de buscar evoluir, nunca!**` },

  { id: 'email_vespera', canal: 'email', titulo: 'Véspera (domingo)', quando: { dia: -1, hora: '19:00' }, filtro: {},
    assunto: 'Amanhã às 8h começa',
    texto: `{{nome}}, amanhã às 8h eu libero o Módulo 1: o Corte Mid Fade com Pompadour e as minhas dicas sobre tesouras.

Antes da primeira aula você gira uma roleta. No primeiro dia todo mundo ganha um prêmio.

[Abrir meu app de aulas]({{app_link}})

Na segunda e na sexta, das 19h às 20h, tem live comigo no Instagram para tirar dúvidas.` },

  ...MODULOS.map(([assunto, txt], i) => ({
    id: `email_modulo_${i + 1}`, canal: 'email', titulo: `Módulo ${i + 1} liberado`, quando: { dia: i, hora: '08:00' }, filtro: {},
    assunto,
    texto: `Bom dia, {{nome}}! O Módulo ${i + 1} da Semana do Barbeiro já está no ar.

${txt}

Gire a roleta antes da primeira aula: cada dia tem um prêmio diferente.

${BTN}${i === 0 || i === 4 ? '\n\nHoje das 19h às 20h tem live comigo no Instagram para tirar as dúvidas.' : ''}`,
  })),

  ...MODULOS.map((_, i) => ({
    id: `wa_modulo_${i + 1}`, canal: 'whatsapp', titulo: `WhatsApp: Módulo ${i + 1} liberado`, quando: { dia: i, hora: '08:00' }, filtro: {},
    flow_cfg: `mc_flow_modulo_${i + 1}`, resumo: `Template sdb_aula_liberada com {{2}} = "Módulo ${i + 1}" e botão com o app_link.`,
  })),

  ...MODULOS.map((_, i) => ({
    id: `wa_lembrete_${i + 1}`, canal: 'whatsapp', titulo: `WhatsApp: lembrete do Módulo ${i + 1} (quem não assistiu)`, quando: { dia: i, hora: '18:00' }, filtro: { dia_sem_aula: i + 1 },
    flow_cfg: 'mc_flow_lembrete', resumo: 'Template sdb_lembrete_nao_assistiu.',
  })),

  ...[1, 5].map(d => ({
    id: `email_live_${d}`, canal: 'email', titulo: `Live de ${d === 1 ? 'segunda' : 'sexta'} (aviso 18h)`, quando: { dia: d - 1, hora: '18:00' }, filtro: {},
    assunto: d === 1 ? 'Hoje às 19h: live do Módulo 1' : 'Hoje às 19h: a última live da Semana',
    texto: `{{nome}}, hoje das 19h às 20h eu estou ao vivo no Instagram${d === 1 ? ' para tirar as dúvidas do primeiro módulo' : ', a última live da Semana do Barbeiro, com uma condição especial para quem quer o curso completo'}.

Traga a sua dúvida que eu respondo ao vivo.

[Ir para a live](https://www.instagram.com/barberschooloficial/)`,
  })),

  ...[1, 5].map(d => ({
    id: `wa_live_${d}`, canal: 'whatsapp', titulo: `WhatsApp: live de ${d === 1 ? 'segunda' : 'sexta'} (18h30)`, quando: { dia: d - 1, hora: '18:30' }, filtro: {},
    flow_cfg: 'mc_flow_live', resumo: 'Template de aviso da live das 19h com o link do Instagram.',
  })),

  { id: 'email_oferta', canal: 'email', titulo: 'Oferta aberta (sexta)', quando: { dia: 4, hora: '12:00' }, filtro: { sem_curso: true },
    assunto: 'Você completou a Semana. Agora é com você.',
    texto: `{{nome}}, essas 10 aulas são uma parte do curso completo da Barber School.

No curso você aprende do básico ao avançado, em mais de 40 horas de aula, com certificado e o grupo de alunos onde eu acompanho a evolução de cada um.

Para quem fez a Semana, o curso sai de R$ 297 por **R$ 147**. E tem 7 dias de garantia: se não gostar, devolvemos seu dinheiro.

[Ver meu desconto]({{app_link}})

Vale até domingo às 23h59.` },

  { id: 'wa_oferta', canal: 'whatsapp', titulo: 'WhatsApp: oferta aberta (sexta)', quando: { dia: 4, hora: '12:00' }, filtro: { sem_curso: true },
    flow_cfg: 'mc_flow_oferta', resumo: 'Template sdb_oferta_aberta.' },

  { id: 'email_duvidas', canal: 'email', titulo: 'Dúvidas do curso (sábado)', quando: { dia: 5, hora: '10:00' }, filtro: { sem_curso: true },
    assunto: '"Serve para quem nunca cortou?"',
    texto: `{{nome}}, separei as perguntas que mais chegaram ontem:

**Serve para quem nunca pegou numa tesoura?** Sim. O curso foi feito para você aprender do zero.

**Já sou barbeiro, serve?** Sim. Você aprende técnicas novas para cobrar mais pelo seu corte.

**É pelo celular?** Sim, 100% online. Você assiste quando e onde quiser, quantas vezes quiser.

**Tem certificado e garantia?** Tem certificado de conclusão e 7 dias de garantia.

[Garantir por R$ 147]({{app_link}})

A condição vai até amanhã às 23h59.` },

  { id: 'email_comunidade', canal: 'email', titulo: 'Comunidade (domingo de manhã)', quando: { dia: 6, hora: '10:00' }, filtro: { sem_curso: true },
    assunto: 'O conselho que mais me fez crescer',
    texto: `{{nome}}, esteja cercado de pessoas que têm o mesmo objetivo que você. Não se isole como barbeiro.

Por isso os alunos da Barber School têm um grupo exclusivo: lá eles mostram a evolução dos cortes, tiram dúvidas e trocam experiência com barbeiros do Brasil inteiro.

[Quero fazer parte]({{app_link}})

A condição da Semana vai até hoje às 23h59.` },

  { id: 'email_ultima', canal: 'email', titulo: 'Última chamada (domingo)', quando: { dia: 6, hora: '18:00' }, filtro: { sem_curso: true },
    assunto: 'Hoje às 23h59 acaba',
    texto: `{{nome}}, é hoje. Às 23h59 o curso volta para R$ 297 e as aulas da Semana saem do ar.

Se você quer ser barbeiro profissional, este é o melhor momento para começar.

[Garantir minha vaga]({{app_link}})` },

  { id: 'wa_ultima_18', canal: 'whatsapp', titulo: 'WhatsApp: última chamada 18h', quando: { dia: 6, hora: '18:00' }, filtro: { sem_curso: true },
    flow_cfg: 'mc_flow_ultima', resumo: 'Template sdb_ultima_chamada.' },
  { id: 'wa_ultima_22', canal: 'whatsapp', titulo: 'WhatsApp: última chamada 22h', quando: { dia: 6, hora: '22:00' }, filtro: { sem_curso: true },
    flow_cfg: 'mc_flow_ultima', resumo: 'Template sdb_ultima_chamada.' },
  // ---------- Convites para listas importadas (aba Leads) ----------
  { id: 'convite_semana_email', canal: 'email', publico: 'contatos', link_tipo: 'semana', titulo: 'Convite da Semana (base antiga)', filtro: { eng: 'nao_convidado' },
    assunto: '{{nome}}, a Semana do Barbeiro voltou (e é grátis)',
    texto: `Olá, {{nome}}! Aqui é o professor Cris Aita, da Barber School.

Há uns anos você se cadastrou na Semana do Barbeiro. Ela voltou, de cara nova: 10 aulas completas do meu curso, de graça, um módulo por dia, direto no celular.

Toda segunda começa uma turma nova, e tem live comigo na segunda e na sexta, das 19h às 20h.

[Quero minha vaga grátis]({{link}})

Se hoje você já corta, as aulas de degradê, barba e acabamento vão te ajudar a cobrar mais pela cadeira. Se ainda não começou, é o melhor jeito de dar o primeiro passo.

Te vejo na segunda!` },

  { id: 'convite_semana_reenvio', canal: 'email', publico: 'contatos', link_tipo: 'semana', titulo: 'Convite da Semana: reenvio para quem não abriu', filtro: { eng: 'nao_abriu' },
    assunto: 'Sua vaga na Semana do Barbeiro ainda está aberta',
    texto: `{{nome}}, passando rapidinho: as inscrições da próxima turma da Semana do Barbeiro estão abertas.

São 10 aulas grátis com o professor Cris Aita, pelo celular, começando na segunda.

[Garantir minha vaga]({{link}})` },

  { id: 'convite_semana_wa', canal: 'whatsapp', publico: 'contatos', link_tipo: 'semana', titulo: 'WhatsApp: convite da Semana (quem abriu ou clicou)', filtro: { eng: 'abriu_ou_clicou' },
    flow_cfg: 'mc_flow_convite', resumo: 'Template de convite da Semana com botão de URL dinâmica usando o campo convite_link.' },

  { id: 'convite_barbeearia_email', canal: 'email', publico: 'contatos', link_tipo: 'barbeearia', titulo: 'Convite Barbeearia: 30 dias do Plus para alunos', filtro: { eng: 'nao_convidado' },
    assunto: '{{nome}}, um presente para os alunos da Barber School',
    texto: `Olá, {{nome}}! Aqui é o professor Cris Aita.

Todo aluno da Barber School ganhou **30 dias grátis do Barbearia Plus**, o plano mais completo da Barbeearia: agenda online, fila e rodízio, clientes, caixa com Pix, comissões, pacotes e lembretes pelo WhatsApp.

Não precisa de cartão. É só criar a sua conta pelo link:

[Ativar meus 30 dias]({{link}})

Organize a sua cadeira desde o primeiro cliente.` },

  { id: 'convite_barbeearia_wa', canal: 'whatsapp', publico: 'contatos', link_tipo: 'barbeearia', titulo: 'WhatsApp: convite Barbeearia (quem abriu ou clicou)', filtro: { eng: 'abriu_ou_clicou' },
    flow_cfg: 'mc_flow_barbeearia', resumo: 'Template do presente de 30 dias do Barbearia Plus com botão usando o campo convite_link.' },
];

// Data/hora (Brasília) de um item do calendário a partir da segunda-feira da turma (AAAA-MM-DD)
const { em } = require('./turma');
const dataDe = (turma, quando) => new Date(em(String(turma).slice(0, 10), quando.dia, quando.hora)).toISOString();

// Ajustes feitos no painel (aba Mensagens): sdb_config.copy_<id> = JSON {assunto, texto}
function ajustar(lista, cfg = {}) {
  return lista.map(c => {
    const raw = cfg[`copy_${c.id}`];
    if (!raw) return c;
    try { const a = JSON.parse(raw); return { ...c, ...(a.assunto != null && c.assunto != null ? { assunto: a.assunto } : {}), ...(a.texto != null ? { texto: a.texto } : {}), ajustada: true }; }
    catch { return c; }
  });
}

module.exports = { COPIES, dataDe, ajustar };
