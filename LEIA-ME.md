# Semana do Barbeiro 2026 — processo completo

**Semana automática, toda semana.** Cada segunda começa uma turma: um módulo por dia (2 aulas) às 8h, de segunda a sexta; lives com o professor Cris Aita **segunda e sexta, das 19h às 20h**; oferta do curso na sexta (depois da roleta do módulo 5) até **domingo 23h59**. Quem se cadastra de segunda a quarta entra na turma da semana; de quinta a domingo, na da próxima segunda. Quem já fez uma Semana não entra de novo.

## 0. Ver e testar

**Mais fácil: a demonstração no navegador (artefato "Semana do Barbeiro").** Abre em qualquer computador ou celular, sem instalar nada. Roda o site, o app e o painel com os mesmos arquivos de produção; pagamentos, Hotmart e ManyChat são simulados. Para gerar de novo depois de mudar algo: `node demo/build.js`.

### Versão local no Mac

1. Descompacte a pasta e dê **duplo clique em `INICIAR-LOCAL.command`**. Se o Mac bloquear, clique com o botão direito → Abrir → Abrir.
2. Abre o **Painel de testes** em `http://localhost:3000/_dev`. Por ele você:
   - abre o site (`localhost:3000`) e o app (`localhost:3001`);
   - simula o dia e a hora da semana (antes de começar, dia 1, dia 3, dia 5 com a oferta, domingo, encerrada);
   - acompanha os cadastros de teste e os eventos;
   - zera os dados.
3. Pagamentos, Hotmart e ManyChat são **simulados**: nenhuma cobrança real. Na fatura ou no checkout de teste, clique em "Simular pagamento aprovado". CPF de teste: 529.982.247-25.
4. Admin: `localhost:3001/admin`, senha `admin12345`.

Precisa do Node.js 20 ou mais novo (nodejs.org). Os dados de teste ficam em `local/dados-local.json` e nunca vão para a Vercel.

## 1. O funil

```
Anúncio / Instagram (palavra SEMANA) / WhatsApp
        │
semanadobarbeiro.com.br ── cadastro grátis (nome, WhatsApp, e-mail, aceite LGPD)
        │                    → Supabase + ManyChat (tag sdb_cadastro, campo app_link)
/quiz ── 5 perguntas, define o perfil (iniciante / ja_corta / profissional)
        │
/certificado ── upsell Certificado de Participação R$ 19,70 (Asaas: Pix, cartão ou boleto)
        │          "Não, quero só as aulas" pula direto
/obrigado ── ativar avisos no WhatsApp + link do app + seguir o Instagram
        │
app.semanadobarbeiro.com.br ── 2 aulas/dia liberadas por horário da turma, progresso, lives seg e sex 19h
        │   sexta da turma: oferta Curso Barber School R$ 297 → R$ 147 (Hotmart) até domingo 23h59
        │
Hotmart (compra) → volta para app.../barberhub → upsell Barbeearia, plano Barbeiro (Asaas)
```

O certificado só aparece para download quando o pagamento está confirmado **e** o aluno marcou as 10 aulas como concluídas.

## 1.1 Roleta do dia

Antes da primeira aula de cada módulo o aluno gira a roleta uma vez. O prêmio é decidido no servidor, um por dia:

| Módulo | Prêmio | O que precisa estar pronto |
|---|---|---|
| 1 (seg) | 30 dias grátis na Barbeearia | Link em `sdb_config.premio_barbeearia_url`. Se preencher `BARBEEARIA_ACESSO_URL` (ex.: https://barbeearia.com.br/api/acesso) e `BARBEEARIA_ACESSO_SECRET` na Vercel, o e-mail do aluno é liberado na hora. O limite de 30 dias precisa ser controlado na Barbeearia. |
| 2 (ter) | Não ganha ("nova chance amanhã") | Nada. |
| 3 (qua) | Acesso ao Clube do Barbeiro | Link em `premio_clube_url`. |
| 4 (qui) | Cupom que deixa o curso vitalício | Criar na Hotmart um cupom com o código de `premio_vitalicio_cupom` (padrão VITALICIO) que dê o acesso vitalício. O app já manda o cupom aplicado no checkout (`offDiscount`). |
| 5 (sex) | Desconto no curso (R$ 297 → R$ 147) | A oferta do curso só aparece depois desse giro. |

A roleta é desenhada em SVG no próprio `assets/app.js` (sem biblioteca externa). Cada giro gera a tag `sdb_roleta_<premio>` no ManyChat (ex.: `sdb_roleta_barbeearia`), útil para mandar o link do prêmio no WhatsApp.

## 2. O que está no pacote

| Pasta | O que é |
|---|---|
| `site/` | Páginas de semanadobarbeiro.com.br: cadastro, quiz, certificado, obrigado, privacidade |
| `app/` | app.semanadobarbeiro.com.br: aulas, certificado para imprimir/PDF, painel `/admin` |
| `api/` | Funções da Vercel: cadastro, quiz, cobranças Asaas, webhooks Asaas/Hotmart, ManyChat |
| `assets/config-publico.js` | **Edite aqui**: número do WhatsApp, Pixel, textos da oferta e do BarberHub |
| `supabase/schema.sql` | Banco: rode uma vez no Supabase |
| `.env.example` | Lista das variáveis secretas que vão na Vercel |

Preços, datas, link da Hotmart e horário da live ficam na tabela **sdb_config** do Supabase. Títulos, vídeos e horários das aulas ficam na tabela **sdb_aulas**. Dá para mudar tudo pelo Table Editor, sem mexer em código.

## 3. Colocar no ar (ordem certa)

**O jeito rápido:** duplo clique em **`COLOCAR-NO-AR.command`** (na pasta do projeto). Ele faz o login na Vercel, cria o projeto, grava as variáveis, publica e liga os domínios. Antes de rodar, faça só o passo 3.1 (Supabase), porque o script pede a URL e a chave de lá. No fim ele mostra a senha do painel, a chave da extensão e o que falta no DNS.

As chaves que você digita no script vão direto para a Vercel: não aparecem na tela e não ficam salvas em arquivo nenhum.

Os passos abaixo são o mesmo caminho feito à mão, conta por conta.

### 3.1 Supabase (10 min)

1. Em supabase.com, crie um projeto só para a Semana do Barbeiro (região **South America (São Paulo)**). Não use o projeto da ACIESC.
2. SQL Editor → cole o conteúdo de `supabase/schema.sql` e rode. Pode rodar de novo depois: ele não apaga nada.
3. Depois que o sistema estiver no ar, volte aqui e rode `supabase/2-agendador.sql` (ele liga o `pg_cron` que manda os e-mails sozinho).
4. Em Configurações → API, copie **Project URL** e a chave **service_role**. É o que o script pede.

### 3.2 Vercel e DNS

O projeto **semanadobarbeiro** (time **BarberSchool**, plano Hobby) está ligado ao repositório `barberschooloficial/semanadobarbeiro` no GitHub: **todo commit na branch `main` publica sozinho**. Para atualizar um arquivo sem terminal: GitHub → pasta → Add file → Upload files → Commit. O repositório é público: nunca suba nele o `COLOCAR-NO-AR.command` nem arquivo com chave.

O DNS do domínio está na **Cloudflare**, na conta barberschooloficial (o registro.br só aponta os nameservers para lá). Depois de publicar, na zona `semanadobarbeiro.com.br`:

| O quê | Ação |
|---|---|
| `AAAA` do apex (`2804:10:8002::210:115`) | apagar |
| `A` do apex (`191.6.210.115`) | virar `CNAME` → `f398e81e6e68eb43.vercel-dns-017.com` |
| `CNAME www` (`web283.uni5.net`) | apontar para `f398e81e6e68eb43.vercel-dns-017.com` |
| `CNAME app` | criar, apontando para `f398e81e6e68eb43.vercel-dns-017.com` |

Os três com a **nuvem cinza (DNS only)**: com a nuvem laranja a Vercel não valida o domínio.

**Não encoste** em `MX`, `imap`, `smtp`, `pop`, `webmail`, `autoconfig`, `autodiscover` e `ftp`: é o e-mail @semanadobarbeiro.com.br, que continua na KingHost (uni5). Hoje o domínio só mostra uma página 404 do Grupo Solus, então não há site para derrubar.

### 3.3 Asaas (Certificado e Barbeearia)
Use a **mesma conta Asaas da Barbeearia**: a chave de API é a mesma nas duas Vercel. O certificado sai com **Pix na própria página** (QR Code + copia e cola, a página confirma sozinha quando o pagamento cai) e um link para pagar com cartão ou boleto. Para o QR aparecer, a conta precisa ter **chave Pix cadastrada** no Asaas; sem ela, a pessoa vai direto para a fatura.

1. Integrações → gere a chave de API. Comece com a de **sandbox** (`ASAAS_ENV=sandbox`) e teste uma compra.
2. Minha Conta → Informações: cadastre o site `semanadobarbeiro.com.br`. Sem isso o Asaas recusa o redirecionamento depois do pagamento.
3. Integrações → Webhooks → nova URL `https://semanadobarbeiro.com.br/api/webhook-asaas`, eventos de **Cobranças**, token igual ao `ASAAS_WEBHOOK_TOKEN`.
4. Depois do teste: troque para a chave de produção e `ASAAS_ENV=producao`, refaça o webhook na conta de produção e faça Redeploy.

### 3.4 Hotmart (Curso R$ 147)
1. No produto do curso, crie a oferta de **R$ 147** e copie o link para `sdb_config.hotmart_checkout_url`.
2. Na oferta, configure a **página de obrigado** como `https://app.semanadobarbeiro.com.br/barberhub`. É ela que mostra o upsell do BarberHub.
3. Ferramentas → Webhook → versão 2.0 → URL `https://semanadobarbeiro.com.br/api/webhook-hotmart`, eventos de compra (aprovada, completa, boleto impresso, reembolso, chargeback, cancelada). Copie o **Hottok** para `HOTMART_HOTTOK` e o ID do produto para `HOTMART_PRODUCT_ID`.
4. O app manda nome, e-mail e `sck=sdb_<id>` para o checkout, então a compra é ligada ao aluno certo mesmo se ele trocar o e-mail.

### 3.5 ManyChat
1. Settings → API → gere o token e coloque em `MANYCHAT_API_KEY`.
2. Crie os **campos de usuário** (texto): `app_link`, `perfil`, `cert_link`.
3. Crie as **tags**: `sdb_cadastro`, `sdb_quiz`, `sdb_perfil_iniciante`, `sdb_perfil_ja_corta`, `sdb_perfil_profissional`, `sdb_cert_pendente`, `sdb_cert_pago`, `sdb_comprou_curso`, `sdb_barberhub_pago`, `sdb_assistiu_d1` até `sdb_assistiu_d5`, `sdb_roleta_barbeearia`, `sdb_roleta_nada`, `sdb_roleta_clube`, `sdb_roleta_vitalicio`, `sdb_roleta_curso`.
4. Envie os 6 templates de WhatsApp para aprovação (ver seção 5). **Fazer hoje.**
5. Monte os fluxos da seção 4.

### 3.6 Últimos ajustes
- `assets/config-publico.js`: número do WhatsApp do ManyChat, Pixel do Meta (opcional), e **confirme** os itens do curso e os recursos do BarberHub.
- Painel: `app.semanadobarbeiro.com.br/admin` com a senha `ADMIN_KEY`.

### 3.7 Disparos (aba Disparos do painel)
O painel `/admin` tem a aba **Disparos**: escolhe a mensagem da biblioteca (ou escreve uma), o público pelos mesmos filtros da lista de alunos, e manda agora ou agenda. O calendário de cada turma é criado sozinho pelo agendador (item 6); o botão **Programar a turma** só adianta isso para a turma em foco.

- **E-mail (Resend):**
  1. Em resend.com → Domains, adicione e verifique `semanadobarbeiro.com.br` (os registros DNS ficam na Cloudflare, com a nuvem cinza).
  2. Na Vercel, preencha `RESEND_API_KEY` e, se quiser, `EMAIL_FROM` (padrão: `Cris Aita | Barber School <aulas@semanadobarbeiro.com.br>`) e `EMAIL_REPLY_TO`.
  3. Todo e-mail sai com o link "não quero mais receber"; quem clica fica com `email_optout = true` e sai dos próximos disparos.
  4. O e-mail de boas-vindas com o link do app sai sozinho logo depois do cadastro.
- **WhatsApp (ManyChat):** o texto fica no template aprovado. Para cada mensagem, crie um **fluxo** no ManyChat com o template e copie o ID do fluxo (`flow_ns`) para `sdb_config`: `mc_flow_modulo_1` a `mc_flow_modulo_5`, `mc_flow_lembrete`, `mc_flow_oferta`, `mc_flow_ultima`. Só recebe quem já está no ManyChat (`manychat_id`).
- **Custo:** o painel mostra a estimativa antes de confirmar. Template de marketing no Brasil custa US$ 0,0718 por mensagem (tabela do ManyChat, jan/2026): 1.000 pessoas ≈ US$ 72 por disparo. Mande WhatsApp só para os cadastrados da Semana, não para a base inteira.
- **Agendador:** já ligado. O `pg_cron` do Supabase chama `/api/disparos?acao=tick` a cada 5 minutos (arquivo `supabase/2-agendador.sql`). O endereço não leva senha: só processa o que já está programado e vencido, com trava de 4 minutos entre uma rodada e outra.

Sem o agendador, o botão **Enviar fila agora** do painel processa na hora (com o painel aberto).

### 3.8 Gestão de leads (aba Leads do painel)
Para reconvidar a base antiga da Semana e convidar os alunos da Barber School para a Barbeearia.

1. **Importar:** exporte a planilha em CSV (Google Planilhas → Arquivo → Fazer download → CSV) ou o relatório de compradores da Hotmart e importe com um nome de lista (`semana_2020`, `alunos_barberschool`). Nome, WhatsApp/telefone, e-mail, cidade, UF e perfil são reconhecidos sozinhos; repetidos e linhas sem contato ficam de fora. A UF e a região saem do DDD do WhatsApp (a UF digitada na base antiga é pouco confiável).
2. **Montar bloco:** filtre por região, UF, cidade e perfil, escolha o tamanho (ex.: 3.000) e crie o bloco. Cada contato fica em um bloco só.
3. **Convidar:** na tabela de blocos, "Convite por e-mail" abre o disparo preenchido. Depois de 1 ou 2 dias, "WhatsApp p/ quem abriu" manda só para quem abriu ou clicou e ainda não se cadastrou; "Reenvio p/ quem não abriu" manda um segundo e-mail.
4. **Acompanhar:** a tabela mostra convidados, abriram (pixel do e-mail), clicaram (link rastreado), cadastraram (o link leva o código do contato até o cadastro) e saíram da lista.

- **Links:** todo link de convite passa por `/api/t?r=...`, que marca o clique e redireciona para o cadastro da Semana (com UTM `utm_medium=convite` e `utm_campaign` = lista + bloco, que aparece na tabela de campanhas) ou para a Barbeearia.
- **WhatsApp:** crie no ManyChat o campo de usuário `convite_link` (texto), os templates de convite com botão de URL dinâmica usando esse campo, e os fluxos em `mc_flow_convite` e `mc_flow_barbeearia`. O sistema cria o contato no ManyChat na hora do envio.
- **Barbeearia:** o link usa `barbeearia_convite_url` (padrão `https://barbeearia.com.br/cadastro?codigo=ALUNOBS30`). **Falta na Barbeearia:** aceitar o código `ALUNOBS30` no cadastro e liberar o plano Barbearia Plus por 30 dias sem cartão.
- **Cuidados com a base fria:** comece com blocos menores no domínio novo (ex.: 500 no 1º dia, 1.500 no 2º, 3.000 depois) para não cair no spam, e acompanhe a coluna "Saíram". No WhatsApp, a Meta limita conversas iniciadas por dia conforme o nível do número; mande só para quem abriu ou clicou.

### 3.9 Grupos, comunidades e canal (aba Grupos do painel)

Os avisos para os grupos de alunos da Barber School, os grupos da Semana do Barbeiro, as comunidades e o canal saem por uma **extensão do Chrome** que roda no WhatsApp Web do número de avisos. Ela posta como se fosse você: um grupo por vez, com "digitando..." e de 20 a 90 segundos entre um e outro. Não há servidor nem custo por mensagem.

1. Na Vercel, crie `WA_EXT_KEY` com 16 ou mais caracteres e rode de novo o `supabase/schema.sql`, que cria as tabelas `sdb_wa_*`.
2. Use um **número novo, só para avisos**, e faça dele administrador de todos os grupos, das comunidades e do canal.
3. No painel, aba Grupos, clique em **Baixar extensão** e descompacte. No Chrome, abra `chrome://extensions`, ligue o Modo do desenvolvedor e clique em **Carregar sem compactação**. Escolha a pasta.
4. Clique no ícone da extensão e cole a `WA_EXT_KEY`. Abra web.whatsapp.com com o número de avisos. Em até 1 minuto, os grupos, comunidades e canais aparecem no painel.
5. No painel, ative cada destino e escolha a categoria. Os grupos marcados como **Semana do Barbeiro** recebem sozinhos o calendário da turma: boas-vindas, módulo das 8h, lembrete, lives, oferta, sábado e última chamada, com no máximo 3 por dia. Para desligar, mude `grupos_auto` para `0` em `sdb_config`.
6. Para os outros avisos, use **Novo aviso**: escolha uma copy da biblioteca ou escreva, marque os destinos e programe para agora ou para depois.

**Cuidados:**
- **Horário:** os avisos só saem com o computador ligado, o Chrome aberto e o WhatsApp Web conectado. Se ficar fechado mais de 3h depois do horário, o aviso automático expira e não sai atrasado.
- **Termos do WhatsApp:** os termos proíbem automação, e existe risco de bloqueio do número. Para reduzir o risco, mande só para os seus grupos e o seu canal, nunca para pessoas soltas. Respeite o limite de 4 avisos por grupo por dia (`wa_limite_dia`) e não use link encurtado.
- **Base técnica:** WA-JS 4.7.2, do WPPConnect, com licença Apache-2.0, empacotada na própria extensão. Revisei o código. A extensão desliga o Google Analytics da biblioteca e os servidores de prévia de link de terceiros que ela traz (uppermesh, titanchat, cloudtrix), para que nada saia para fora do WhatsApp e do painel. A extensão só fala com semanadobarbeiro.com.br.
- **Quando o WhatsApp Web mudar:** se ele mudar e a extensão parar, o quadrinho no canto do WhatsApp Web mostra o erro. Aí basta trocar o `wppconnect-wa.js` pela versão nova do npm (`@wppconnect/wa-js`).

### 3.10 Configurações (aba Configurações do painel)

Tudo o que muda no dia a dia fica nessa aba e vale em até 1 minuto, sem publicar nada: **WhatsApp do suporte** (o número dos botões de WhatsApp do site e do app; se a Meta bloquear, troque ali), link do grupo, link da live, link do checkout da Hotmart, preços, links e cupom dos prêmios da roleta, hora de abertura dos módulos, dias e horários das lives, e os liga/desliga da automação. Cada campo confere o formato antes de salvar.

As chaves de API não ficam nessa aba: continuam na Vercel, em Settings → Environment Variables. Depois de trocar uma chave lá, faça Redeploy.

## 4. Fluxos do ManyChat

### WhatsApp
| Gatilho | O que faz |
|---|---|
| Palavra-chave **SEMANA** (vem do botão da página /obrigado) | Se o contato tem `app_link`: "Pronto, seus avisos estão ativos! Seu acesso: {{app_link}}". Se não tem: manda o link do cadastro `semanadobarbeiro.com.br/?origem=whatsapp&utm_source=whatsapp`. |
| Regra: tag `sdb_cadastro` aplicada | Espera 2 min → template `sdb_boas_vindas` (só se a pessoa não mandou SEMANA nos últimos 5 min). |
| Regra: tag `sdb_cert_pendente` aplicada | Espera 1h → se **não** tem `sdb_cert_pago`: template `sdb_certificado_pendente` com {{cert_link}}. Repete 1 vez depois de 24h. |
| Regra: tag `sdb_comprou_curso` aplicada | Mensagem de boas-vindas ao curso + link `{{app_link}}` trocando o fim por `/barberhub` (oferta do BarberHub). |
| Regra: tag `sdb_barberhub_pago` aplicada | Avisa você (notificação para admin) para liberar o acesso ao BarberHub. |

### Instagram — 4 automações (a montar no ManyChat)

Padrão igual nas quatro: comentário em **post, reels ou live** com a palavra-chave, ou **resposta de story** com ela, dispara uma resposta pública curta ("Te mandei no direct! 💈") e um DM.

No DM, o pedido de seguir vem antes do link, com dois botões: **Já sigo** e **Seguir agora**. A condição de seguidor do ManyChat entra só para escolher o texto — **nunca para travar o link**: ela atrasa e deixa passar seguidor antigo, e link travado é cadastro perdido. Quem clica em "Já sigo" recebe o link na hora.

| Automação | Conta | Palavras | Para onde manda |
|---|---|---|---|
| **Barbeearia.app** | @barbeearia.app | barbearia, barbeearia, app | `barbeearia.com.br/cadastro?codigo=ALUNOBS30` — **30 dias** do plano completo |
| **Semana do Barbeiro – Cadastro** | @barberschool | semana, semana do barbeiro, aula grátis | `semanadobarbeiro.com.br/?utm_source=instagram&utm_medium=dm&origem=instagram` |
| **Clube do Barbeiro** | @barberschool | clube, club, desconto | `clube.barberschool.com.br` (confirmar se o endereço já está no ar) |
| **Semana do Barbeiro – Envio** | — | — | não é fluxo de Instagram; ver abaixo |

**Cuidados:**

- A palavra **app** é genérica e pega comentário solto ("qual app?", "baixei o app"). Vale manter no começo e acompanhar; se encher de disparo errado, trocar por "barbeearia".
- Toda automação aplica uma tag de origem (`ig_barbeearia`, `ig_semana`, `ig_clube`) para dar para medir depois.
- No DM cabe **um** lembrete no mesmo dia para quem não clicou. Depois disso a janela fecha.

### Por que o lembrete diário não é no Direct

A Meta só deixa mandar mensagem automática dentro de **24h** desde a última mensagem da pessoa. A janela de 7 dias existe, mas é só para mensagem escrita por humano no inbox. Então a sequência diária da semana **não pode** morar no Direct.

Ela já está pronta nos canais que aguentam: **e-mail** (sai sozinho) e **WhatsApp** (templates aprovados, fluxos `mc_flow_modulo_1` a `mc_flow_modulo_5`, `mc_flow_lembrete`, `mc_flow_live`, `mc_flow_oferta`, `mc_flow_ultima`). O Instagram é a porta de entrada: entrega o link, a pessoa se cadastra, e a partir daí recebe por e-mail e WhatsApp.

No Direct ficam só duas coisas: o lembrete do mesmo dia e a palavra **AULA**, que a pessoa pode mandar quando quiser — como ela escreve primeiro, a janela abre e o link do app pode ir.

## 5. Templates de WhatsApp (categoria Marketing, pt_BR)

1. **sdb_boas_vindas**: boas-vindas + {{2}} link do app + botão "Acessar minhas aulas".
2. **sdb_aula_liberada**: {{2}} nome da aula + {{3}} link do app.
3. **sdb_lembrete_nao_assistiu**: lembrete das aulas do dia + {{2}} link do app.
4. **sdb_oferta_aberta**: abertura da condição de R$ 147 + {{2}} link do app.
5. **sdb_ultima_chamada**: encerramento hoje 23h59 + {{2}} link do app.
6. **sdb_certificado_pendente**: cobrança em aberto + {{2}} link do pagamento.

(O texto completo de cada um foi enviado no chat.) Em todos, {{1}} é o primeiro nome.

## 6. Cronograma de cada turma (automático)

O agendador cria estes disparos sozinho para a turma atual e a próxima (aba **Disparos** do painel). Os WhatsApps só entram depois que o `flow_ns` de cada fluxo estiver em `sdb_config`.

| Quando | Canal | Mensagem | Público |
|---|---|---|---|
| Domingo 19h (véspera) | E-mail | "Amanhã às 8h começa" | turma |
| Seg a sex 08h | E-mail + WhatsApp | Módulo do dia liberado | turma |
| Seg a sex 18h | WhatsApp | Lembrete | turma, só quem não assistiu ao módulo do dia |
| Seg e sex 18h / 18h30 | E-mail / WhatsApp | Aviso da live das 19h | turma |
| Seg e sex 19h às 20h | Instagram | **Live** com o professor Cris Aita (na sexta, abertura da oferta) | — |
| Sex 12h | E-mail + WhatsApp | Oferta aberta (R$ 147) | turma, sem quem comprou |
| Sáb 10h | E-mail | Dúvidas do curso | turma, sem quem comprou |
| Dom 10h | E-mail | Comunidade | turma, sem quem comprou |
| Dom 18h (e 22h no WhatsApp) | E-mail + WhatsApp | Última chamada | turma, sem quem comprou |
| Dom 23h59 | — | Oferta e aulas da turma saem do ar sozinhas | — |

Horários editáveis em `sdb_config`: `aula_hora`, `live_dias`, `live_inicio`, `live_fim`. Para pausar a programação automática: `disparos_auto = 0`.

## 6.1 Rastreio e funil

- Toda página registra a visita e as ações principais em `sdb_trilha` (cadastro, Pix do certificado, WhatsApp, app aberto, roleta, play na aula, oferta vista, clique em comprar, Barbeearia, live, Saiba mais), com a campanha de origem (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`).
- **Use sempre UTM nos links** de anúncio, bio e posts: `semanadobarbeiro.com.br/?utm_source=instagram&utm_medium=reels&utm_campaign=kit_iniciante`.
- Painel → **Visão geral**: funil de conversão (visitas → cadastro → enquete → app → 1ª aula → 10 aulas → oferta vista → clique em comprar → compra) com % da etapa anterior e do total, filtro por turma e por campanha, tabela de campanhas (visitas, cadastros, conversão, cursos, receita) e tabela de turmas.
- A ficha de cada aluno mostra a linha do tempo das ações dele.
- Os webhooks agora respondem em `/api/webhook?de=asaas` e `/api/webhook?de=hotmart`; os endereços antigos `/api/webhook-asaas` e `/api/webhook-hotmart` continuam funcionando.

Títulos e vídeos das aulas ficam em `sdb_aulas` (a coluna `libera_em` não é mais usada: a liberação segue a turma).

## 7. Checklist antes da primeira turma

Sem isso a semana não roda sozinha:

- [ ] `supabase/schema.sql` rodado no SQL Editor (pode rodar de novo: não apaga nada).
- [ ] Variáveis na Vercel: Supabase, `ADMIN_KEY`, `ASAAS_*`, `HOTMART_HOTTOK`, `RESEND_API_KEY`, `CRON_SECRET`, `WA_EXT_KEY`, `MANYCHAT_API_KEY`.
- [ ] **Agendador** (item 3.7): `pg_cron` chamando `/api/disparos?acao=processar` a cada 5 min. No painel → Disparos, o selo "Agendador" mostra a última vez que a fila rodou; se passar de 15 min, aparece "atrasado". Enquanto a extensão do WhatsApp estiver aberta, ela também processa a fila atrasada (reserva).
- [ ] Domínio `semanadobarbeiro.com.br` verificado no Resend (DNS na KingHost) e um e-mail de teste enviado pelo painel.
- [ ] Cadastro de teste com o seu WhatsApp → chegou em `sdb_leads`, no ManyChat (tag `sdb_cadastro`, campo `app_link`) e o e-mail de boas-vindas chegou.
- [ ] Enquete → perfil gravado na ficha do aluno.
- [ ] Certificado no **sandbox** do Asaas → Pix na página → "pago" no painel.
- [ ] App: módulos fechados mostram a data certa (segunda da turma às 8h). Para ver liberado sem esperar, use a versão local, que simula o relógio.
- [ ] Compra de teste na Hotmart (ou webhook de teste) → `curso_status = pago` e o aluno segue com as aulas depois do domingo.
- [ ] ManyChat: `flow_ns` dos fluxos em `sdb_config` (sem eles o WhatsApp individual fica de fora do calendário; o e-mail sai de qualquer jeito).
- [ ] Grupos: extensão instalada no Chrome do número de avisos, grupos ativados e marcados como "Semana do Barbeiro" no painel.
- [ ] Vídeos: `youtube_id` das 10 aulas em `sdb_aulas`.

## 8. Decisões tomadas e cuidados

- Sem escassez falsa ("restam 3 vagas") e sem promessa de renda: a Meta reprova anúncios e templates assim, e o Procon também pega. A urgência é o prazo real de domingo.
- O certificado é de **participação em curso livre**, deixado claro na página para evitar reclamação.
- CPF só é pedido nas compras pelo Asaas (exigência da emissão da cobrança).
- Quem já está cadastrado e se cadastra de novo com o mesmo WhatsApp recebe o mesmo acesso, sem trocar nome e e-mail.
- Aula bloqueada nunca envia o ID do vídeo para o navegador.
