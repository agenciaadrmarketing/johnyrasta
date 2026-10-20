-- Fase 3 — velocidade: URLs monitoradas, fila de medições, medições e CrUX.

create table monitored_urls (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid        not null references accounts(id) on delete cascade,
  site_id     uuid        not null,
  url         text        not null,
  priority    integer     not null default 1 check (priority between 1 and 3),
  devices     text[]      not null default array['mobile', 'desktop'],
  -- 'diaria' é o padrão de produto; 'manual' só quando pedido.
  frequency   text        not null default 'diaria' check (frequency in ('diaria', 'manual')),
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, account_id),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade,
  constraint monitored_urls_devices check (devices <@ array['mobile', 'desktop'] and cardinality(devices) >= 1)
);
create unique index monitored_urls_site_url_key on monitored_urls (site_id, url) where archived_at is null;
create index monitored_urls_site_idx on monitored_urls (site_id);

-- Fila genérica de trabalhos com lease. Fase 3 usa 'pagespeed'.
-- Unicidade por chave lógica: URL + dispositivo + janela (dia) — só um ATIVO.
create table audit_jobs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid        not null references accounts(id) on delete cascade,
  site_id        uuid        not null,
  kind           text        not null check (kind in ('pagespeed')),
  dedupe_key     text        not null,
  payload        jsonb       not null default '{}'::jsonb,
  state          text        not null default 'pendente' check (state in ('pendente', 'processando', 'concluido', 'falhou', 'cancelado')),
  attempts       integer     not null default 0,
  max_attempts   integer     not null default 4,
  run_after      timestamptz not null default now(),
  lease_token    uuid,
  lease_until    timestamptz,
  last_error     text,
  error_category text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create unique index audit_jobs_active_key on audit_jobs (dedupe_key) where state in ('pendente', 'processando');
create index audit_jobs_due_idx on audit_jobs (run_after) where state = 'pendente';
create index audit_jobs_site_idx on audit_jobs (site_id, created_at desc);

create table performance_runs (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid        not null references accounts(id) on delete cascade,
  site_id            uuid        not null,
  monitored_url_id   uuid        not null,
  url                text        not null,
  device             text        not null check (device in ('mobile', 'desktop')),
  measured_at        timestamptz not null default now(),
  status             text        not null check (status in ('ok', 'parcial', 'erro')),
  error_category     text        check (error_category in ('sem_chave', 'cota', 'timeout', 'pagina_inacessivel', 'resposta_parcial', 'resposta_invalida', 'bloqueado', 'desconhecido')),
  error_detail       text,
  performance        integer,
  accessibility      integer,
  best_practices     integer,
  seo                integer,
  lcp_ms             integer,
  cls                numeric(6,3),
  tbt_ms             integer,
  fcp_ms             integer,
  speed_index_ms     integer,
  diagnostics        jsonb       not null default '[]'::jsonb,
  lighthouse_version text,
  source_version     text,
  config             jsonb       not null default '{}'::jsonb,
  -- Marcado quando a nota caiu em relação à medição comparável anterior.
  regression         boolean     not null default false,
  job_id             uuid,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade,
  foreign key (monitored_url_id, account_id) references monitored_urls (id, account_id) on delete cascade
);
create index performance_runs_url_device_idx on performance_runs (monitored_url_id, device, measured_at desc);
create index performance_runs_site_idx on performance_runs (site_id, measured_at desc);

create table crux_snapshots (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid        not null references accounts(id) on delete cascade,
  site_id       uuid        not null,
  -- 'url' = a própria página; 'origin' = o site inteiro (a fonte caiu para a origem).
  scope         text        not null check (scope in ('url', 'origin')),
  identifier    text        not null,
  device        text        not null check (device in ('mobile', 'desktop')),
  collected_at  timestamptz not null default now(),
  -- Janela informada pela fonte (quando informa). Null = fonte não informou.
  period_start  date,
  period_end    date,
  overall       text,
  lcp_p75_ms    integer,
  inp_p75_ms    integer,
  cls_p75       numeric(6,3),
  raw           jsonb       not null default '{}'::jsonb,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create index crux_site_idx on crux_snapshots (site_id, collected_at desc);

do $$
declare t text;
begin
  foreach t in array array['monitored_urls', 'audit_jobs', 'performance_runs', 'crux_snapshots'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

grant select, insert, update, delete on monitored_urls to app_web;
grant select, insert, update on audit_jobs to app_web;
grant select on performance_runs, crux_snapshots to app_web;
create policy monitored_urls_tenant on monitored_urls for all to app_web using (account_id = app.current_account_id()) with check (account_id = app.current_account_id());
create policy audit_jobs_tenant on audit_jobs for all to app_web using (account_id = app.current_account_id()) with check (account_id = app.current_account_id());
create policy performance_runs_tenant on performance_runs for select to app_web using (account_id = app.current_account_id());
create policy crux_tenant on crux_snapshots for select to app_web using (account_id = app.current_account_id());

grant select on monitored_urls to app_worker;
grant select, insert, update on audit_jobs to app_worker;
grant select, insert on performance_runs, crux_snapshots to app_worker;
create policy monitored_urls_worker on monitored_urls for select to app_worker using (true);
create policy audit_jobs_worker on audit_jobs for all to app_worker using (true) with check (true);
create policy performance_runs_worker on performance_runs for all to app_worker using (true) with check (true);
create policy crux_worker on crux_snapshots for all to app_worker using (true) with check (true);
-- Alerta de fila parada precisa do nome do site: já concedido (sites select).
