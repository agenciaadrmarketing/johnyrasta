-- Fase 2 — disponibilidade: fila com lease nos monitores, checagens,
-- incidentes, alertas e retenção.
--
-- A FILA é a própria tabela monitors: `next_check_at` diz quando é devido,
-- `lease_token`/`lease_until` dizem quem está processando. Reivindicação com
-- FOR UPDATE SKIP LOCKED; um worker antigo não finaliza trabalho retomado por
-- outro porque toda gravação confere o token.

alter table monitors
  add column lease_token          uuid,
  add column lease_until          timestamptz,
  add column consecutive_failures integer     not null default 0,
  add column last_check_at        timestamptz,
  add column last_ok              boolean,
  add column last_failure_at      timestamptz,
  add column tls_expires_at       timestamptz,
  add column tls_state            text        not null default 'desconhecido'
                                  check (tls_state in ('desconhecido', 'valido', 'sem_tls', 'falha')),
  add column manual_requested_at  timestamptz;

create index monitors_lease_idx on monitors (lease_until) where lease_token is not null;

-- ───────────────────────── checagens ─────────────────────────
-- Uma linha por tentativa. Retenção: 30 dias (worker apaga).

create table checks (
  id              bigserial primary key,
  account_id      uuid        not null references accounts(id) on delete cascade,
  monitor_id      uuid        not null,
  site_id         uuid        not null,
  checked_at      timestamptz not null default now(),
  ok              boolean     not null,
  http_status     integer,
  -- Tempo até os cabeçalhos da resposta FINAL, em ms.
  duration_ms     integer,
  error_category  text        check (error_category in (
                    'dns', 'bloqueado', 'conexao', 'timeout', 'tls', 'http', 'redirecionamentos', 'tamanho', 'desconhecido')),
  error_detail    text,
  final_url       text,
  redirects       integer     not null default 0,
  tls_expires_at  timestamptz,
  worker_id       text,
  foreign key (monitor_id, account_id) references monitors (id, account_id) on delete cascade,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create index checks_monitor_time_idx on checks (monitor_id, checked_at desc);
create index checks_site_time_idx on checks (site_id, checked_at desc);
create index checks_time_idx on checks (checked_at);

-- ───────────────────────── incidentes ─────────────────────────
-- Persistem mesmo depois que as checagens antigas são apagadas.
-- Um incidente ABERTO por monitor (índice parcial).

create table incidents (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid        not null references accounts(id) on delete cascade,
  monitor_id        uuid        not null,
  site_id           uuid        not null,
  first_failure_at  timestamptz not null,
  confirmed_at      timestamptz,
  recovered_at      timestamptz,
  -- 'isolada' quando a primeira falha não se confirmou; 'confirmado' quando
  -- duas falhas seguidas; preenchido no fechamento.
  outcome           text        check (outcome in ('isolada', 'confirmado')),
  cause_category    text,
  cause_detail      text,
  failed_checks     integer     not null default 1,
  created_at        timestamptz not null default now(),
  foreign key (monitor_id, account_id) references monitors (id, account_id) on delete cascade,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index incidents_one_open_per_monitor on incidents (monitor_id) where recovered_at is null;
create index incidents_site_idx on incidents (site_id, first_failure_at desc);

-- ───────────────────────── alertas ─────────────────────────
-- Um alerta por condição/episódio. `dedupe_key` é o contrato: a mesma condição
-- em dez checagens produz UMA linha.

create table alerts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid        not null references accounts(id) on delete cascade,
  site_id      uuid,
  kind         text        not null check (kind in (
                 'incidente_confirmado', 'incidente_recuperado', 'verificacao_atrasada',
                 'tls_vencendo', 'tls_falha', 'coletor_parado', 'fila_parada')),
  severity     text        not null check (severity in ('alta', 'media', 'baixa')),
  dedupe_key   text        not null,
  title        text        not null,
  details      jsonb       not null default '{}'::jsonb,
  state        text        not null default 'aberto' check (state in ('aberto', 'resolvido', 'silenciado')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index alerts_dedupe_key on alerts (account_id, dedupe_key);
create index alerts_open_idx on alerts (account_id, created_at desc) where state = 'aberto';

-- ───────────────────────── permissões ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['checks', 'incidents', 'alerts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- A central lê checagens e incidentes; gerencia alertas (resolver/silenciar).
grant select on checks, incidents to app_web;
grant select, update on alerts to app_web;
create policy checks_tenant    on checks    for select to app_web using (account_id = app.current_account_id());
create policy incidents_tenant on incidents for select to app_web using (account_id = app.current_account_id());
create policy alerts_tenant    on alerts    for all    to app_web
  using (account_id = app.current_account_id()) with check (account_id = app.current_account_id());

-- O worker grava checagens, incidentes e alertas; apaga checagens antigas.
grant select, insert, delete on checks to app_worker;
grant usage on sequence checks_id_seq to app_worker;
grant select, insert, update on incidents, alerts to app_worker;
create policy checks_worker    on checks    for all to app_worker using (true) with check (true);
create policy incidents_worker on incidents for all to app_worker using (true) with check (true);
create policy alerts_worker    on alerts    for all to app_worker using (true) with check (true);
