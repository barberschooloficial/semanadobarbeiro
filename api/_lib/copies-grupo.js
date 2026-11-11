// Copies dos grupos de WhatsApp (base: COPIES.md, seção 1) e calendário automático dos grupos da Semana.
// dia = dias depois da segunda-feira da turma (-2 = sábado antes). Só entram no automático os itens com "auto".
// No máximo 3 avisos por dia em cada grupo, para não parecer spam nem cansar a turma.

const APP = 'app.semanadobarbeiro.com.br';
const IG = 'instagram.com/barberschooloficial';

const MODULO = [
  `☀️ *Bom dia, barbeiros!* São 8h e o *Módulo 1* está liberado: *Equipamentos básicos do barbeiro* e *Tudo sobre pentes*. Gire a roleta e assista agora 👉 ${APP}`,
  `☀️ *Bom dia, barbeiros!* *Módulo 2* liberado: *Corte Mid Fade com Pompadour* e *Dicas sobre tesouras*. A roleta de hoje já está esperando você 👉 ${APP}`,
  `☀️ *Bom dia!* *Módulo 3* no ar: a dica para *cortar cabelo com muito redemoinho* e o *Corte Razor Part*. 🎡 Gire a roleta antes da primeira aula 👉 ${APP}`,
  `☀️ *Bom dia!* *Módulo 4*: *Barba passo a passo* e *Flat Top com High Fade*. Hoje a roleta está generosa 😉 👉 ${APP}`,
  `☀️ *Último módulo!* *Módulo 5*: *High Fade em "V" atrás* e *Progressiva masculina na barbearia*, o serviço que aumenta o ticket da cadeira. Gire a última roleta da semana 👉 ${APP}`,
];

const LIVE = `🔴 *Estamos ao vivo no Instagram!*
Entra agora e tira suas dúvidas direto com o professor Cris Aita 👉 ${IG}`;

const ULTIMA = `⏳ *Último dia!*
Hoje às *23h59* o curso volta para R$ 297 e as aulas da Semana saem do ar.

Se você quer ser barbeiro profissional com certificado, a hora é agora 👉 ${APP}`;

const COPIES_GRUPO = [
  { id: 'g_antes', titulo: 'Antes de começar (sáb e dom, 19h)', texto: `💈 A *Semana do Barbeiro* começa *segunda-feira às 8h*!

São *10 aulas 100% grátis* com o professor *Cris Aita*, criador da Barber School. Um módulo por dia, de segunda a sexta, direto no celular.

*Fiquem no grupo e aguardem até lá!*

Conhece alguém que quer ser barbeiro? Manda o link para ele se cadastrar 👇🏻
semanadobarbeiro.com.br` },
  { id: 'g_boas_vindas', titulo: 'Boas-vindas + regras (seg, 7h30)', auto: [{ dia: 0, hora: '07:30' }], texto: `💈 Sejam muito bem-vindos à *Semana do Barbeiro*! 💈

Aqui no grupo eu aviso cada módulo assim que for liberado. As aulas ficam no seu app:
👉 ${APP}
(entre com o WhatsApp e o e-mail do cadastro)

🕗 *Todo dia às 8h* sai um módulo novo com *2 aulas completas*.
🎡 Antes da primeira aula do dia você gira a *roleta* e pode ganhar prêmios.
📺 *Segunda e sexta, das 19h às 20h*, tem live com o professor Cris Aita no Instagram para tirar dúvidas.

🚨 Este grupo é só para avisos. As dúvidas o professor Cris Aita responde nas lives 👉 ${IG}

As aulas ficam no ar até *domingo às 23h59*. Bora! 🙌🏻` },
  { id: 'g_regras_avisos', titulo: 'Regras: grupo só de avisos', texto: `🚨 *Este grupo é só para avisos das aulas!*

Somos muitos grupos e milhares de inscritos, então não conseguimos responder todo mundo por aqui.

😇 Mas *segunda e sexta, das 19h às 20h*, o professor Cris Aita faz uma *live tira-dúvidas* no Instagram. Já segue para não perder:
👉 ${IG}

As aulas ficam no ar até *domingo às 23h59*.

Bora aproveitar a Semana do Barbeiro! Sucesso para todos! 💈` },
  { id: 'g_regras_aberto', titulo: 'Regras: grupo aberto para conversa', texto: `💬 *Este grupo é para quem está fazendo a Semana do Barbeiro.*

Pode mandar dúvida das aulas, foto do seu corte e trocar ideia com a galera. Só 3 regras:
1️⃣ Respeito sempre.
2️⃣ Nada de propaganda, link de outros cursos ou corrente.
3️⃣ Dúvida de pagamento ou acesso: chama o suporte no privado.

As dúvidas técnicas o professor Cris Aita responde nas *lives de segunda e sexta, às 19h*, no Instagram 👉 ${IG}` },
  ...MODULO.map((texto, i) => ({ id: `g_modulo_${i + 1}`, titulo: `Módulo ${i + 1} liberado (8h)`, auto: [{ dia: i, hora: '08:00' }], texto })),
  { id: 'g_meio_dia', titulo: 'Meio do dia: o professor Cris Aita passando (12h45)', texto: `Opa, galera! *Cris Aita* passando aqui 👋🏻
Já assistiram às aulas de hoje? Me contem qual foi a melhor 👇🏻

Me conta aqui embaixo a sua maior dúvida 👇🏻 Na *sexta às 19h* tem live e eu respondo ao vivo.` },
  { id: 'g_lembrete', titulo: 'Lembrete de quem não assistiu (ter a qui, 18h)', auto: [1, 2, 3].map(dia => ({ dia, hora: '18:00' })), texto: `⏰ Ainda não assistiu ao módulo de hoje?
São 2 aulas curtas, dá para ver agora mesmo pelo celular 👉 ${APP}

Quem chegou agora: todos os módulos anteriores continuam liberados até domingo.` },
  { id: 'g_live', titulo: 'Live no ar (seg e sex, 19h)', auto: [{ dia: 0, hora: '19:00' }, { dia: 4, hora: '19:00' }], texto: LIVE },
  { id: 'g_atrasado', titulo: 'Quem chegou atrasado (14h)', texto: `Chegou agora? Sem problema! 😁
Todos os módulos já liberados estão no seu app. Em menos de 1 hora você assiste tudo 👉 ${APP}` },
  { id: 'g_oferta', titulo: 'Sexta: a oferta abre (12h)', auto: [{ dia: 4, hora: '12:00' }], texto: `🎉 *Acabou a Semana do Barbeiro... e começou a sua chance!*

Quem girou a roleta hoje ganhou o *desconto no curso completo da Barber School*:
de ~R$ 297~ por *R$ 147*, em até 12x no cartão.

✅ Mais de 40h de aulas, do básico ao avançado
✅ Certificado de conclusão
✅ Grupo de alunos com o professor Cris Aita
✅ 7 dias de garantia

O desconto aparece no seu app, logo abaixo da roleta 👉 ${APP}
*Vale só até domingo às 23h59.*` },
  { id: 'g_sabado', titulo: 'Sábado: dúvida mais comum (10h)', auto: [{ dia: 5, hora: '10:00' }], texto: `Bom dia, barbeiros! 💈

Muita gente me perguntou ontem: "Cris Aita, o curso serve para quem nunca pegou numa máquina?"
Serve sim! Foi feito para você aprender do zero. E se você já é barbeiro, vai aprender técnicas novas para cobrar mais pelo seu corte.

O desconto de R$ 147 vai até amanhã às 23h59 👉 ${APP}` },
  { id: 'g_ultima', titulo: 'Domingo: última chamada (18h e 22h)', auto: [{ dia: 6, hora: '18:00' }, { dia: 6, hora: '22:00' }], texto: ULTIMA },
  { id: 'g_encerramento', titulo: 'Encerramento (segunda seguinte)', texto: `Obrigado por fazer parte da *Semana do Barbeiro*! 🙏🏻💈
Para quem entrou na Barber School: bem-vindo à família! O acesso chegou no seu e-mail.
Para todos: continuem acompanhando o professor Cris Aita no Instagram 👉 ${IG}` },
];

module.exports = { COPIES_GRUPO };
