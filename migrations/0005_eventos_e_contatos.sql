-- Fase 4 — eventos, sessões, formulários, contatos, diagnóstico.
--
-- Dois papéis públicos novos (criados por scripts/db-setup.ts):
--   app_ingest → só o endpoint de eventos: sites (leitura), sessões, eventos, diagnóstico.
--   app_forms  → só o endpoint de formulários: submissões, contatos e identidades.
-- Nenhum dos dois enxerga usuários, sessões de login, incidentes ou medições.

-- Os papéis são objetos do cluster; se o setup não os criou (URLs ausentes),
-- cria sem senha (NOLOGIN) para as permissões existirem. O operador define a
-- senha ao configurar as URLs e rodar `npm run db:setup` de novo.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ingest') then create role app_ingest nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_forms') then create role app_forms nologin; end if;
end $$;
grant usage on schema public to app_ingest, app_forms;
grant usage on schema app to app_ingest, app_forms;

create table site_tracking (
  site_id              uuid primary key,
  account_id           uuid        not null references accounts(id) on delete cascade,
  collect_pageviews    boolean     not null default true,
  collect_clicks       boolean     not null default true,
  -- 'endpoint' = o site posta direto na central; 'webhook' = destino original confirma por assinatura;
  -- 'auxiliar' = o coletor envia cópia da tentativa (nunca prova entrega no destino).
  form_mode            text        not null default 'endpoint' check (form_mode in ('endpoint', 'webhook', 'auxiliar', 'desligado')),
  form_allowed_fields  text[]      not null default array['name', 'email', 'phone'],
  collect_message      boolean     not null default false,
  -- 'nenhum' = coleta sem identificador persistente até consentimento; 'exigido' = espera sinal do site.
  consent_mode         text        not null default 'nenhum' check (consent_mode in ('nenhum', 'exigido')),
  default_country      text        not null default 'BR',
  webhook_secret_hash  text,
  collector_version    text        not null default 'v1',
  updated_at           timestamptz not null default now(),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid        not null references accounts(id) on delete cascade,
  site_id       uuid        not null,
  session_key   text        not null,
  visitor_id    text,
  started_at    timestamptz not null,
  last_seen_at  timestamptz not null,
  entry_path    text,
  source        text        not null default 'direto',
  medium        text,
  campaign      text,
  referrer_host text,
  device        text        not null default 'desconhecido',
  is_test       boolean     not null default false,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index sessions_site_key on sessions (site_id, session_key);
create index sessions_site_started_idx on sessions (site_id, started_at desc);

create table events (
  id              bigserial primary key,
  account_id      uuid        not null references accounts(id) on delete cascade,
  site_id         uuid        not null,
  -- Gerado pelo coletor por gesto. Reenvio de rede e script instalado duas
  -- vezes colapsam aqui. A verificação acontece ANTES de qualquer efeito.
  event_id        text        not null,
  session_id      uuid        not null references sessions(id) on delete cascade,
  visitor_id      text,
  type            text        not null check (type in ('page_view', 'click', 'form_attempt')),
  path            text        not null,
  button_id       text,
  button_pos      text,
  button_text     text,
  action_kind     text        check (action_kind in ('whatsapp', 'phone', 'email', 'form', 'outro')),
  auto_detected   boolean     not null default false,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null default now(),
  is_test         boolean     not null default false,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade,
  constraint events_click_kind check ((type = 'click' and action_kind is not null) or (type <> 'click'))
);
create unique index events_site_event_id on events (site_id, event_id);
create index events_site_time_idx on events (site_id, occurred_at desc);
create index events_session_idx on events (session_id, occurred_at);
create index events_site_type_idx on events (site_id, type, occurred_at desc);

create table contacts (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid        not null references accounts(id) on delete cascade,
  site_id        uuid        not null,
  name           text,
  first_real_at  timestamptz,
  last_real_at   timestamptz,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create index contacts_site_idx on contacts (site_id, first_real_at desc);

create table contact_identities (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid        not null references accounts(id) on delete cascade,
  site_id     uuid        not null,
  contact_id  uuid        not null references contacts(id) on delete cascade,
  kind        text        not null check (kind in ('email', 'phone')),
  value       text        not null,
  created_at  timestamptz not null default now(),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index contact_identities_site_kind_value on contact_identities (site_id, kind, value);
create index contact_identities_contact_idx on contact_identities (contact_id);

create table submissions (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid        not null references accounts(id) on delete cascade,
  site_id             uuid        not null,
  submission_id       text        not null,
  mode                text        not null check (mode in ('endpoint', 'webhook', 'auxiliar')),
  -- recebido: dados válidos persistidos aqui. confirmado_destino: o sistema original confirmou.
  -- falha_destino: o site informou que o destino falhou. tentativa: só intenção, sem dados.
  receipt_status      text        not null check (receipt_status in ('recebido', 'confirmado_destino', 'falha_destino', 'tentativa')),
  evidence_source     text        not null,
  page_path           text,
  session_key         text,
  session_id          uuid        references sessions(id) on delete set null,
  contact_id          uuid        references contacts(id) on delete set null,
  fields              jsonb       not null default '{}'::jsonb,
  attributed_event_id bigint      references events(id) on delete set null,
  attribution         text        not null default 'sem_atribuicao' check (attribution in ('ultimo_clique', 'sem_atribuicao')),
  is_test             boolean     not null default false,
  is_new_lead         boolean     not null default false,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index submissions_site_submission_id on submissions (site_id, submission_id);
create index submissions_site_time_idx on submissions (site_id, occurred_at desc);
create index submissions_contact_idx on submissions (contact_id);

-- E-mail aponta para A, telefone para B: registrado, nunca mesclado sozinho.
create table contact_conflicts (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid        not null references accounts(id) on delete cascade,
  site_id          uuid        not null,
  submission_id    uuid        not null references submissions(id) on delete cascade,
  email_contact_id uuid        not null references contacts(id) on delete cascade,
  phone_contact_id uuid        not null references contacts(id) on delete cascade,
  resolved_at      timestamptz,
  resolution       text,
  created_at       timestamptz not null default now(),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);

-- Replay protection do webhook assinado.
create table webhook_nonces (
  site_id    uuid        not null,
  nonce      text        not null,
  seen_at    timestamptz not null default now(),
  primary key (site_id, nonce)
);

create table diagnostic_sessions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid        not null references accounts(id) on delete cascade,
  site_id     uuid        not null,
  token       text        not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  evidence    jsonb       not null default '{}'::jsonb,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create index diagnostic_site_idx on diagnostic_sessions (site_id, created_at desc);

-- ───────────────────────── permissões ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['site_tracking', 'sessions', 'events', 'contacts', 'contact_identities', 'submissions', 'contact_conflicts', 'webhook_nonces', 'diagnostic_sessions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- A central: tudo da conta.
grant select, insert, update on site_tracking to app_web;
grant select on sessions, events, submissions, contact_identities, contact_conflicts to app_web;
grant select, update on contacts, contact_conflicts to app_web;
grant select, insert, update on diagnostic_sessions to app_web;
do $$
declare t text;
begin
  foreach t in array array['site_tracking', 'sessions', 'events', 'contacts', 'contact_identities', 'submissions', 'contact_conflicts', 'diagnostic_sessions'] loop
    execute format($f$ create policy %1$I_tenant on %1$I for all to app_web using (account_id = app.current_account_id()) with check (account_id = app.current_account_id()) $f$, t);
  end loop;
end $$;

-- app_ingest: eventos e nada mais.
grant select on sites, site_tracking to app_ingest;
grant select, insert, update on sessions to app_ingest;
grant select, insert on events to app_ingest;
grant usage on sequence events_id_seq to app_ingest;
grant select, update on diagnostic_sessions to app_ingest;
create policy sites_ingest on sites for select to app_ingest using (archived_at is null);
create policy tracking_ingest on site_tracking for select to app_ingest using (true);
create policy sessions_ingest on sessions for all to app_ingest using (true) with check (true);
create policy events_ingest on events for all to app_ingest using (true) with check (true);
create policy diag_ingest on diagnostic_sessions for all to app_ingest using (true) with check (true);

-- app_forms: submissões, contatos e atribuição (lê eventos da sessão).
grant select on sites, site_tracking to app_forms;
grant select, insert, update on sessions to app_forms;
grant select on events to app_forms;
grant select, insert, update on contacts, contact_identities, submissions, contact_conflicts to app_forms;
grant select, insert, delete on webhook_nonces to app_forms;
grant select, update on diagnostic_sessions to app_forms;
create policy sites_forms on sites for select to app_forms using (archived_at is null);
create policy tracking_forms on site_tracking for select to app_forms using (true);
create policy sessions_forms on sessions for all to app_forms using (true) with check (true);
create policy events_forms on events for select to app_forms using (true);
create policy contacts_forms on contacts for all to app_forms using (true) with check (true);
create policy identities_forms on contact_identities for all to app_forms using (true) with check (true);
create policy submissions_forms on submissions for all to app_forms using (true) with check (true);
create policy conflicts_forms on contact_conflicts for all to app_forms using (true) with check (true);
create policy nonces_forms on webhook_nonces for all to app_forms using (true) with check (true);
create policy diag_forms on diagnostic_sessions for all to app_forms using (true) with check (true);

-- O worker apaga eventos antigos (retenção) e lê volumes para o alerta de coleta.
grant select, delete on events to app_worker;
grant select on submissions, performance_runs to app_worker;
grant delete on performance_runs to app_worker;
create policy events_worker on events for all to app_worker using (true) with check (true);
create policy submissions_worker on submissions for select to app_worker using (true);
