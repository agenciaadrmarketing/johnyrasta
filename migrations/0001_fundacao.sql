-- JohnyWeb V2 — fundação: contas, usuários, sessões, clientes, sites, monitores
-- (estrutura), favoritos, heartbeat do worker e trilha de auditoria.
--
-- Toda entidade de negócio carrega account_id. As relações entre entidades
-- usam chave composta (id, account_id) para que um site NUNCA aponte para um
-- cliente de outra conta, mesmo que o código erre.

create schema if not exists app;

-- ───────────────────────── contas e usuários ─────────────────────────

create table accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  -- Conta de demonstração: identificada na interface. Nunca é reserva de erro.
  is_demo     boolean     not null default false,
  created_at  timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid        not null references accounts(id) on delete cascade,
  email         text        not null,
  password_hash text        not null,
  name          text        not null,
  role          text        not null default 'owner' check (role in ('owner', 'operator')),
  created_at    timestamptz not null default now(),
  unique (id, account_id)
);
create unique index users_email_key on users (lower(email));
create index users_account_idx on users (account_id);

-- Sessões no BANCO, não em JWT: encerrar uma sessão tem efeito imediato, e
-- "encerrar as outras sessões" é uma linha de SQL. O cookie leva só o token
-- opaco; aqui fica o hash dele.
create table auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references users(id) on delete cascade,
  account_id   uuid        not null references accounts(id) on delete cascade,
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  user_agent   text,
  ip           inet
);
create index auth_sessions_user_idx on auth_sessions (user_id, expires_at desc);

-- ───────────────────────── clientes e sites ─────────────────────────

create table clients (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid        not null references accounts(id) on delete cascade,
  name        text        not null,
  notes       text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, account_id)
);
create index clients_account_idx on clients (account_id);
create unique index clients_account_name_key on clients (account_id, lower(name)) where archived_at is null;

create table sites (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid        not null references accounts(id) on delete cascade,
  client_id     uuid        not null,
  name          text        not null,
  -- Domínio normalizado: minúsculas, sem porta, sem "www." (política de
  -- subdomínio: www é o mesmo site; outros subdomínios são sites distintos).
  domain        text        not null,
  primary_url   text        not null,
  timezone      text        not null default 'America/Sao_Paulo',
  platform      text        not null default 'outro'
                check (platform in ('html', 'wordpress', 'react', 'next', 'framer', 'webflow', 'wix', 'shopify', 'outro')),
  -- Identificador PÚBLICO para o coletor (Fase 4). Não autoriza nada.
  public_id     text        not null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  unique (id, account_id),
  -- O cliente precisa ser DA MESMA CONTA. Chave composta, não só client_id.
  foreign key (client_id, account_id) references clients (id, account_id) on delete restrict,
  constraint sites_domain_normalized check (domain = lower(domain) and domain !~ '^www\.' and domain !~ '[/:\s]'),
  constraint sites_timezone_nonempty check (length(timezone) > 0)
);
create unique index sites_public_id_key on sites (public_id);
create unique index sites_account_domain_key on sites (account_id, domain) where archived_at is null;
create index sites_account_idx on sites (account_id);
create index sites_client_idx on sites (client_id);

create table site_favorites (
  account_id  uuid        not null references accounts(id) on delete cascade,
  user_id     uuid        not null,
  site_id     uuid        not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, site_id),
  foreign key (user_id, account_id) references users (id, account_id) on delete cascade,
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);

-- ───────────────────────── monitores (estrutura) ─────────────────────────
-- O worker (Fase 2) consome esta tabela. Na Fase 1 ela existe para que o
-- cadastro já registre a decisão "monitorar sim/não", e a central mostre
-- "Nunca verificado" em vez de inventar um estado.

create table monitors (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid        not null references accounts(id) on delete cascade,
  site_id           uuid        not null,
  url               text        not null,
  interval_seconds  integer     not null default 300 check (interval_seconds between 60 and 3600),
  timeout_ms        integer     not null default 10000 check (timeout_ms between 1000 and 30000),
  enabled           boolean     not null default true,
  next_check_at     timestamptz,
  maintenance_until timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, account_id),
  unique (site_id),
  foreign key (site_id, account_id) references sites (id, account_id) on delete cascade
);
create index monitors_due_idx on monitors (next_check_at) where enabled;

-- ───────────────────────── saúde do próprio sistema ─────────────────────────

create table worker_heartbeats (
  worker_id   text primary key,
  seen_at     timestamptz not null default now(),
  version     text,
  details     jsonb       not null default '{}'::jsonb
);

-- ───────────────────────── auditoria ─────────────────────────
-- Operações administrativas relevantes. Sem conteúdo sensível: nada de senha,
-- token ou corpo de formulário.

create table audit_log (
  id          bigserial primary key,
  account_id  uuid        not null references accounts(id) on delete cascade,
  user_id     uuid,
  action      text        not null,
  target_type text        not null,
  target_id   text,
  details     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_account_idx on audit_log (account_id, created_at desc);

-- updated_at automático
create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger sites_touch before update on sites for each row execute function app.touch_updated_at();
