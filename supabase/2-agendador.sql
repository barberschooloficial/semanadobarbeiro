-- Agendador da Semana do Barbeiro (rode DEPOIS do schema.sql)
-- Chama o sistema a cada 5 minutos para enviar os e-mails e WhatsApps programados.
-- Não leva senha: o endereço só processa o que já venceu e tem trava de 4 minutos.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('sdb-disparos') where exists (select 1 from cron.job where jobname = 'sdb-disparos');

select cron.schedule('sdb-disparos', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://semanadobarbeiro.com.br/api/disparos?acao=tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

select jobname, schedule, active from cron.job where jobname = 'sdb-disparos';
