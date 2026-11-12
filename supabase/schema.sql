-- Semana do Barbeiro — schema Supabase
-- Rode este arquivo inteiro no SQL Editor de um projeto Supabase NOVO (não misture com outros clientes).
-- Todas as tabelas ficam com RLS ligado e SEM políticas: só o backend (service_role) lê e escreve.

create extension if not exists pgcrypto;

-- Leads / alunos da Semana
create table if not exists sdb_leads (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique default encode(gen_random_bytes(18), 'hex'),
  nome             text not null,
  whatsapp         text not null unique,          -- só dígitos, com DDI 55
  email            text not null,
  lgpd_consent     boolean not null default false,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  origem           text,                           -- site | instagram | whatsapp | afiliado
  quiz             jsonb,
  perfil           text,                           -- iniciante | ja_corta | profissional
  quiz_at          timestamptz,
  cpf              text,
  cert_status      text check (cert_status in ('pendente','pago','cancelado')),
  cert_payment_id  text,
  cert_invoice_url text,
  cert_paid_at     timestamptz,
  curso_status     text check (curso_status in ('pendente','pago','reembolsado','cancelado')),
  curso_transacao  text,
  curso_paid_at    timestamptz,
  barberhub_status text check (barberhub_status in ('pendente','pago','cancelado')),
  barberhub_payment_id  text,
  barberhub_invoice_url text,
  barberhub_paid_at     timestamptz,
  manychat_id      text,
  email_optout     boolean not null default false,
  turma_inicio     date,                            -- segunda-feira da turma (Semana do Barbeiro automática)  -- clicou em "não quero mais receber e-mails"
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists sdb_leads_email_idx on sdb_leads (lower(email));
create index if not exists sdb_leads_created_idx on sdb_leads (created_at);

-- Aulas (edite títulos, youtube_id e horários pelo Table Editor do Supabase)
create table if not exists sdb_aulas (
  id          serial primary key,
  ordem       int not null unique,
  dia         int not null check (dia between 1 and 7),
  titulo      text not null,
  descricao   text,
  youtube_id  text,                                -- só o ID do vídeo (não listado no YouTube)
  duracao_min int,
  libera_em   timestamptz not null,
  ativo       boolean not null default true
);

-- Progresso (aula assistida)
create table if not exists sdb_progresso (
  lead_id     uuid not null references sdb_leads(id) on delete cascade,
  aula_id     int  not null references sdb_aulas(id) on delete cascade,
  assistiu_em timestamptz not null default now(),
  primary key (lead_id, aula_id)
);

-- Roleta: um giro por módulo (dia). O prêmio é decidido no servidor (api/_lib/premios.js)
create table if not exists sdb_roleta (
  lead_id    uuid not null references sdb_leads(id) on delete cascade,
  dia        int  not null check (dia between 1 and 7),
  premio     text not null,
  fatia      int  not null,
  created_at timestamptz not null default now(),
  primary key (lead_id, dia)
);

-- Disparos de e-mail e WhatsApp (fila com agendamento)
create table if not exists sdb_disparos (
  id           bigserial primary key,
  canal        text not null check (canal in ('email','whatsapp')),
  titulo       text,
  copy_id      text,                                 -- item da biblioteca (api/_lib/copies.js)
  filtro       jsonb not null default '{}',          -- mesmo filtro do painel de alunos
  assunto      text,
  texto        text,
  flow_ns      text,                                 -- fluxo do ManyChat com o template aprovado
  publico      text not null default 'leads',        -- leads (cadastros da Semana) | contatos (listas importadas)
  link_tipo    text,                                 -- contatos: semana | barbeearia
  agendar_em   timestamptz not null default now(),
  status       text not null default 'agendado' check (status in ('agendado','enviando','concluido','cancelado','erro')),
  total        int not null default 0,
  enviados     int not null default 0,
  falhas       int not null default 0,
  erro         text,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists sdb_disparos_fila_idx on sdb_disparos (status, agendar_em);

-- Quem já recebeu cada disparo (evita mandar 2x)
create table if not exists sdb_disparo_envios (
  disparo_id bigint not null references sdb_disparos(id) on delete cascade,
  lead_id    uuid   not null references sdb_leads(id) on delete cascade,
  status     text not null,                          -- enviado | falha
  erro       text,
  enviado_em timestamptz not null default now(),
  primary key (disparo_id, lead_id)
);

-- Gestão de leads: listas importadas (base antiga da Semana, alunos da Barber School...) para convites em blocos
create table if not exists sdb_contatos (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default encode(gen_random_bytes(12), 'hex'),  -- vai no link e no pixel do convite
  lista        text not null,                         -- ex.: semana_2020, alunos_barberschool
  nome         text,
  whatsapp     text,                                  -- 55 + DDD + número
  email        text,
  cidade       text,
  uf           text,
  regiao       text,                                  -- Sudeste, Sul, Nordeste, Centro-Oeste, Norte
  perfil       text,
  extra        jsonb,                                 -- colunas originais que não têm campo próprio
  bloco        text,                                  -- ex.: B01 · Sudeste · 09/11
  email_optout boolean not null default false,
  wa_optout    boolean not null default false,
  manychat_id  text,
  lead_id      uuid references sdb_leads(id) on delete set null,  -- virou cadastro da Semana
  aberto_em    timestamptz,                           -- abriu algum convite (pixel)
  clicado_em   timestamptz,                           -- clicou no link de algum convite
  created_at   timestamptz not null default now()
);
create index if not exists sdb_contatos_lista_idx on sdb_contatos (lista, bloco);
create index if not exists sdb_contatos_email_idx on sdb_contatos (lista, email);
create index if not exists sdb_contatos_whats_idx on sdb_contatos (lista, whatsapp);

-- Quem da lista já recebeu cada disparo
create table if not exists sdb_contato_envios (
  disparo_id bigint not null references sdb_disparos(id) on delete cascade,
  contato_id uuid   not null references sdb_contatos(id) on delete cascade,
  status     text not null,
  erro       text,
  enviado_em timestamptz not null default now(),
  primary key (disparo_id, contato_id)
);
create index if not exists sdb_contato_envios_contato_idx on sdb_contato_envios (contato_id);

-- Rastreio de ações no site e no app (visitas, cliques, vídeos, oferta) com a campanha de origem
create table if not exists sdb_trilha (
  id           bigserial primary key,
  sessao       text not null,                         -- id anônimo do navegador
  lead_id      uuid references sdb_leads(id) on delete set null,
  tipo         text not null,
  pagina       text,
  detalhe      text,
  utm_source   text, utm_medium text, utm_campaign text, utm_content text,
  ref          text,
  created_at   timestamptz not null default now()
);
create index if not exists sdb_trilha_tipo_idx on sdb_trilha (tipo, created_at);
create index if not exists sdb_trilha_sessao_idx on sdb_trilha (sessao);

-- Log de eventos (webhooks, compras, cliques) — também garante idempotência
create table if not exists sdb_eventos (
  id         bigserial primary key,
  lead_id    uuid references sdb_leads(id) on delete set null,
  tipo       text not null,
  chave      text unique,                          -- id externo do evento (evita processar 2x)
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sdb_eventos_tipo_idx on sdb_eventos (tipo, created_at);

-- Configurações editáveis sem mexer no código
create table if not exists sdb_config (
  chave text primary key,
  valor text not null,
  descricao text
);

alter table sdb_leads     enable row level security;
alter table sdb_aulas     enable row level security;
alter table sdb_progresso enable row level security;
alter table sdb_eventos   enable row level security;
alter table sdb_roleta    enable row level security;
alter table sdb_disparos enable row level security;
alter table sdb_trilha enable row level security;
alter table sdb_contatos enable row level security;
alter table sdb_contato_envios enable row level security;
alter table sdb_disparos add column if not exists publico text not null default 'leads';
alter table sdb_disparos add column if not exists link_tipo text;
alter table sdb_disparo_envios enable row level security;
-- para bancos criados antes desta versão
alter table sdb_leads add column if not exists email_optout boolean not null default false;
alter table sdb_leads add column if not exists turma_inicio date;
update sdb_leads set turma_inicio = '2026-11-02' where turma_inicio is null;  -- quem entrou antes das turmas automáticas
create index if not exists sdb_leads_turma_idx on sdb_leads (turma_inicio);
alter table sdb_config    enable row level security;

-- Painel: números do funil em uma consulta
create or replace view sdb_funil as
select
  count(*)                                              as cadastros,
  count(*) filter (where quiz_at is not null)           as quiz_respondido,
  count(*) filter (where cert_status = 'pago')          as certificados_pagos,
  count(*) filter (where curso_status = 'pago')         as cursos_vendidos,
  count(*) filter (where barberhub_status = 'pago')     as barberhub_vendidos,
  count(*) filter (where last_seen_at is not null)      as acessaram_app,
  (select count(distinct lead_id) from sdb_progresso)   as assistiram_1_aula
from sdb_leads;
-- A view não passa pelo RLS: só o servidor (service_role) lê
alter view sdb_funil set (security_invoker = true);
revoke all on sdb_funil from anon, authenticated;
alter view sdb_funil set (security_invoker = true);

-- ===== Seeds (horário de Brasília, -03:00) =====
insert into sdb_config (chave, valor, descricao) values
  ('semana_inicio',        '2026-11-02T08:00:00-03:00', 'Só para cadastros antigos sem turma. As turmas novas começam sozinhas toda segunda'),
  ('aula_hora',            '08:00',                      'Hora em que cada módulo abre (segunda a sexta)'),
  ('live_dias',            '1,5',                        'Dias das lives (1 = segunda, 5 = sexta)'),
  ('live_inicio',          '19:00',                      'Início das lives'),
  ('live_fim',             '20:00',                      'Fim das lives'),
  ('disparos_auto',        '1',                          '1 = o agendador programa sozinho os disparos de cada turma'),
  ('curso_site_url',       'https://www.barberschool.com.br', 'Para onde vai quem já fez uma Semana e tenta se cadastrar de novo'),
  ('curso_preco_de',       '297',                        'Preço cheio exibido'),
  ('curso_preco_por',      '147',                        'Preço da oferta'),
  ('curso_parcelas',       'ou parcelado em até 12x no cartão', 'Texto do parcelamento (confira na Hotmart)'),
  ('hotmart_checkout_url', 'https://pay.hotmart.com/J9278817W?off=COLOQUE_O_CODIGO_DA_OFERTA_147', 'Link do checkout da oferta R$147'),
  ('cert_preco',           '19.70',                      'Preço do certificado (Asaas)'),
  ('barberhub_preco',      '37.00',                      'Preço da Barbeearia no upsell (plano Barbeiro mensal) — CONFIRME'),
  ('barberhub_ciclo',      'MONTHLY',                    'MONTHLY = assinatura mensal | UNICO = pagamento único'),
  ('premio_barbeearia_url', 'https://barbeearia.com.br',  'Roleta dia 1: link para ativar os 30 dias da Barbeearia'),
  ('premio_clube_url',     'https://clube.barberschool.com.br', 'Roleta dia 3: link do Clube do Barbeiro'),
  ('premio_vitalicio_cupom','VITALICIO',                 'Roleta dia 4: cupom criado na Hotmart que deixa o curso vitalício'),
  ('mc_flow_modulo_1',     '',                           'ManyChat: flow_ns do fluxo "aula liberada" do módulo 1'),
  ('mc_flow_modulo_2',     '',                           'ManyChat: fluxo do módulo 2'),
  ('mc_flow_modulo_3',     '',                           'ManyChat: fluxo do módulo 3'),
  ('mc_flow_modulo_4',     '',                           'ManyChat: fluxo do módulo 4'),
  ('mc_flow_modulo_5',     '',                           'ManyChat: fluxo do módulo 5'),
  ('mc_flow_lembrete',     '',                           'ManyChat: fluxo do lembrete das 18h'),
  ('mc_flow_oferta',       '',                           'ManyChat: fluxo da oferta aberta'),
  ('mc_flow_ultima',       '',                           'ManyChat: fluxo da última chamada'),
  ('whatsapp_custo_usd',   '0.0718',                     'Custo por template de marketing no Brasil (ManyChat, jan/2026) para a estimativa do painel'),
  ('grupo_whatsapp_url',   '',                           'Link do grupo/canal de avisos (opcional)'),
  ('live_url',             'https://www.instagram.com/barberschooloficial/', 'Onde acontece a live diária'),
  ('mc_flow_convite',      '',                           'ManyChat: fluxo do convite da Semana para a base antiga'),
  ('mc_flow_barbeearia',   '',                           'ManyChat: fluxo do convite da Barbeearia para alunos'),
  ('barbeearia_convite_url','https://barbeearia.com.br/cadastro?codigo=ALUNOBS30', 'Link do convite de 30 dias do Barbearia Plus para alunos (o código precisa existir na Barbeearia)'),
  ('mc_flow_live',         '',                           'ManyChat: fluxo do aviso de live (segunda e sexta)')
on conflict (chave) do nothing;

insert into sdb_aulas (ordem, dia, titulo, descricao, duracao_min, libera_em) values
  (1,  1, 'Corte Mid Fade com Pompadour',           'Passo a passo completo do degradê médio.',                    25, '2026-11-02T08:00:00-03:00'),
  (2,  1, 'Dicas sobre tesouras',                   'Como escolher, usar e cuidar das tesouras, na live do professor Cris Aita.', 37, '2026-11-02T08:00:00-03:00'),
  (3,  2, 'Equipamentos básicos do barbeiro',      'O que você precisa ter na bancada para começar.',            15, '2026-11-03T08:00:00-03:00'),
  (4,  2, 'Tudo sobre pentes',                      'Qual pente usar em cada etapa do corte.',                     12, '2026-11-03T08:00:00-03:00'),
  (5,  3, 'Como cortar cabelo com muito redemoinho','A dica que resolve o redemoinho sem estragar o corte.',       12, '2026-11-04T08:00:00-03:00'),
  (6,  3, 'Corte Razor Part',                       'Risca na navalha com segurança.',                             15, '2026-11-04T08:00:00-03:00'),
  (7,  4, 'Barba passo a passo',                    'Preparação, toalha quente, desenho e acabamento.',            20, '2026-11-05T08:00:00-03:00'),
  (8,  4, 'Flat Top com High Fade',                 'Corte clássico com degradê alto.',                            25, '2026-11-05T08:00:00-03:00'),
  (9,  5, 'High Fade em "V" atrás',                 'Degradê alto com acabamento em V na nuca.',                   20, '2026-11-06T08:00:00-03:00'),
  (10, 5, 'Progressiva masculina na barbearia',     'Um serviço a mais para aumentar o ticket da cadeira.',        20, '2026-11-06T08:00:00-03:00')
on conflict (ordem) do nothing;

-- ---------- Grupos, comunidades e canal do WhatsApp (extensão do Chrome no WhatsApp Web) ----------
-- Destinos que o número de avisos administra; a extensão sincroniza, o painel ativa e classifica.
create table if not exists sdb_wa_destinos (
  id            text primary key,              -- 1203...@g.us (grupo/comunidade) ou ...@newsletter (canal)
  nome          text not null,
  tipo          text not null check (tipo in ('grupo','comunidade','canal')),
  envio_id      text,                          -- comunidade: grupo de avisos onde a mensagem é postada
  categoria     text not null default 'nenhuma',
  admin         boolean not null default false,
  participantes integer,
  ativo         boolean not null default false,
  visto_em      timestamptz,
  criado_em     timestamptz not null default now()
);

create table if not exists sdb_wa_avisos (
  id           bigserial primary key,
  titulo       text,
  copy_id      text,
  texto        text not null,
  imagem_url   text,
  destinos     jsonb not null default '[]'::jsonb,
  agendar_em   timestamptz not null default now(),
  expira_em    timestamptz,
  status       text not null default 'agendado',   -- agendado, enviando, concluido, cancelado, expirado
  total        integer not null default 0,
  enviados     integer not null default 0,
  falhas       integer not null default 0,
  erro         text,
  origem       text not null default 'painel',     -- painel ou auto (calendário da turma)
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists sdb_wa_avisos_fila_idx on sdb_wa_avisos (status, agendar_em);

create table if not exists sdb_wa_aviso_envios (
  aviso_id   bigint not null references sdb_wa_avisos(id) on delete cascade,
  destino_id text   not null,
  status     text not null,
  erro       text,
  msg_id     text,
  enviado_em timestamptz not null default now(),
  primary key (aviso_id, destino_id)
);

alter table sdb_wa_destinos     enable row level security;
alter table sdb_wa_avisos       enable row level security;
alter table sdb_wa_aviso_envios enable row level security;

insert into sdb_config (chave, valor, descricao) values
  ('grupos_auto',      '1',  'Programa sozinho os avisos da turma nos grupos marcados como "Semana do Barbeiro" (0 desliga)'),
  ('wa_limite_dia',    '4',  'Máximo de avisos por grupo/canal por dia'),
  ('wa_intervalo_min', '20', 'Extensão: segundos mínimos entre um grupo e outro'),
  ('wa_intervalo_max', '90', 'Extensão: segundos máximos entre um grupo e outro')
on conflict (chave) do nothing;

insert into sdb_config (chave, valor, descricao) values
  ('whatsapp_suporte', '', 'WhatsApp do suporte (55 + DDD + número). Troque pela aba Configurações do painel')
on conflict (chave) do nothing;
-- Boas-vindas no privado (Bia do suporte) para quem entra nos grupos da Semana
create table if not exists sdb_wa_dm (
  id          bigserial primary key,
  chave       text not null unique,                 -- bv:<número ou id>: uma boas-vindas por pessoa
  grupo_id    text,
  para        text not null,                        -- 55...@c.us (ou ...@lid quando o WhatsApp esconde o número)
  pn          text,
  lead_id     uuid references sdb_leads(id) on delete set null,
  nome_wa     text,
  texto       text,                                 -- montado na hora do envio
  status      text not null default 'pendente',     -- pendente, enviado, falha, expirado
  tentativas  integer not null default 0,
  tentado_em  timestamptz,
  agendar_em  timestamptz not null default now(),
  enviado_em  timestamptz,
  erro        text,
  msg_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists sdb_wa_dm_fila_idx on sdb_wa_dm (status, agendar_em);
alter table sdb_wa_dm enable row level security;
revoke all on sdb_wa_dm from anon, authenticated;

insert into sdb_config (chave, valor, descricao) values
  ('wa_bv_ativo',      '1',     'Boas-vindas da Bia no privado para quem entra nos grupos da Semana (0 desliga)'),
  ('wa_bv_limite_dia', '60',    'Boas-vindas no privado: máximo por dia'),
  ('wa_bv_inicio',     '08:00', 'Boas-vindas no privado: a partir de'),
  ('wa_bv_fim',        '21:00', 'Boas-vindas no privado: até')
on conflict (chave) do nothing;
