-- Fase 5 — notificações por e-mail: preferências da conta, preferência por
-- site e OUTBOX de entregas.
--
-- O alerta continua sendo a verdade (alerts, deduplicado por chave). A entrega
-- é outra coisa: uma linha por (alerta, canal, destinatário), com tentativas,
-- backoff e resultado do provedor. A UNIQUE (alert_id, channel, recipient) é
-- o contrato de não reenvio: a mesma condição nunca chega duas vezes à mesma
-- caixa de entrada, mesmo com dois workers e dez rodadas.

-- ───────────────────────── preferências da conta ─────────────────────────

create table notification_settings (
  account_id        uuid primary key references accounts(id) on delete cascade,
  email_enabled     boolean     not null default false,
  email_recipients  text[]      not null default '{}',
  kinds             text[]      not null default array[
                      'incidente_confirmado', 'incidente_recuperado', 'tls_vencendo', 'tls_falha',
                      'verificacao_atrasada', 'coletor_parado', 'fila_parada'],
  -- Corte temporal: só alertas criados DEPOIS desta data são enfileirados.
  -- Ligar o e-mail não despeja o histórico antigo na caixa de entrada.
  updated_at        timestamptz not null default now()
);

-- ───────────────────────── preferência por site ─────────────────────────
-- Sem linha = ligado. A linha existe só para desligar (ou religar) um site.

create table site_notification_prefs (
  site_id        uuid primary key,
  account_id     uuid        not null references accounts(id) on delete cascade,
  email_enabled  boolean     not null default true,
  updated_at     timestamptz not null default now(),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);

-- ───────────────────────── outbox de entregas ─────────────────────────
-- A referência ao alerta é composta (alert_id, account_id): uma entrega nunca
-- aponta para alerta de outra conta, mesmo que o código erre (mesma regra de
-- sites → clients, D06).

alter table alerts add constraint alerts_id_account_key unique (id, account_id);

create table alert_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid        not null references accounts(id) on delete cascade,
  alert_id             uuid        not null references alerts(id) on delete cascade,
  channel              text        not null check (channel in ('email')),
  recipient            text        not null,
  state                text        not null default 'pendente'
                       check (state in ('pendente', 'enviado', 'falhou', 'descartado')),
  attempts             integer     not null default 0,
  max_attempts         integer     not null default 5,
  next_attempt_at      timestamptz not null default now(),
  last_error           text,
  provider             text,
  provider_message_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  sent_at              timestamptz,
  unique (alert_id, channel, recipient),
  foreign key (alert_id, account_id) references alerts (id, account_id) on delete cascade
);
create index alert_deliveries_due_idx on alert_deliveries (next_attempt_at) where state = 'pendente';
create index alert_deliveries_account_idx on alert_deliveries (account_id, created_at desc);
create index alert_deliveries_alert_idx on alert_deliveries (alert_id);

-- ───────────────────────── permissões ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['notification_settings', 'site_notification_prefs', 'alert_deliveries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- A central: edita preferências da própria conta e LÊ as entregas. Nunca insere
-- entrega: quem decide o que sai é o worker, a partir dos alertas.
grant select, insert, update on notification_settings, site_notification_prefs to app_web;
grant select on alert_deliveries to app_web;
create policy notification_settings_tenant on notification_settings for all to app_web
  using (account_id = app.current_account_id()) with check (account_id = app.current_account_id());
create policy site_notification_prefs_tenant on site_notification_prefs for all to app_web
  using (account_id = app.current_account_id()) with check (account_id = app.current_account_id());
create policy alert_deliveries_tenant on alert_deliveries for select to app_web
  using (account_id = app.current_account_id());

-- O worker: lê preferências (de todas as contas), alertas e sites (já
-- concedidos nas fases 2 e 1), e grava as entregas.
grant select on notification_settings, site_notification_prefs to app_worker;
grant select, insert, update on alert_deliveries to app_worker;
create policy notification_settings_worker on notification_settings for select to app_worker using (true);
create policy site_notification_prefs_worker on site_notification_prefs for select to app_worker using (true);
create policy alert_deliveries_worker on alert_deliveries for all to app_worker using (true) with check (true);
