-- Autorização no banco. Ocultar na interface não basta: aqui a restrição é do
-- Postgres e vale mesmo que o servidor erre.
--
-- Papéis (criados por scripts/db-setup.ts, pois são objetos do cluster):
--   app_web    → a central. Enxerga apenas a própria conta, via RLS.
--   app_worker → Fase 2: monitores, checagens, heartbeat. Sem usuários/sessões.

-- Conta da requisição, definida por SET LOCAL a cada transação.
-- Ausente => NULL => nenhuma política casa => nega tudo.
create or replace function app.current_account_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.account_id', true), '')::uuid $$;

grant usage on schema public to app_web, app_worker;
grant usage on schema app    to app_web, app_worker;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'users', 'auth_sessions', 'clients', 'sites', 'site_favorites',
    'monitors', 'audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ───────────────────────── app_web ─────────────────────────

grant select on accounts to app_web;
grant select on users to app_web;
grant select, insert, update, delete on clients, sites, site_favorites, monitors to app_web;
grant insert, select on audit_log to app_web;
grant usage on sequence audit_log_id_seq to app_web;
grant select on worker_heartbeats to app_web;

create policy accounts_self on accounts for select to app_web
  using (id = app.current_account_id());
create policy users_tenant on users for select to app_web
  using (account_id = app.current_account_id());

do $$
declare t text;
begin
  foreach t in array array['clients', 'sites', 'site_favorites', 'monitors', 'audit_log'] loop
    execute format($f$
      create policy %1$I_tenant on %1$I for all to app_web
        using (account_id = app.current_account_id())
        with check (account_id = app.current_account_id())
    $f$, t);
  end loop;
end $$;

-- ───────────────────────── autenticação ─────────────────────────
-- Login e validação de sessão acontecem ANTES de existir contexto de conta.
-- A saída não é afrouxar a RLS: são funções SECURITY DEFINER estreitas.
-- `set search_path` é obrigatório em SECURITY DEFINER.

create or replace function app.find_user_for_login(p_email text)
  returns table (user_id uuid, account_id uuid, password_hash text)
  language sql security definer stable
  set search_path = public, app
  as $$
    select u.id, u.account_id, u.password_hash
      from users u
     where lower(u.email) = lower(p_email)
  $$;

create or replace function app.create_session(
  p_user_id uuid, p_token_hash text, p_expires_at timestamptz, p_user_agent text, p_ip text
) returns uuid
  language sql security definer
  set search_path = public, app
  as $$
    insert into auth_sessions (user_id, account_id, token_hash, expires_at, user_agent, ip)
    select u.id, u.account_id, p_token_hash, p_expires_at, left(p_user_agent, 300), nullif(p_ip, '')::inet
      from users u where u.id = p_user_id
    returning id
  $$;

-- Devolve o usuário da sessão válida e avança last_seen_at (no máximo uma vez
-- por minuto, para não escrever a cada render).
create or replace function app.find_user_for_session(p_token_hash text)
  returns table (
    session_id uuid, user_id uuid, account_id uuid, email text, name text, role text,
    account_name text, is_demo boolean
  )
  language plpgsql security definer
  set search_path = public, app
  as $$
begin
  update auth_sessions s
     set last_seen_at = now()
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     and s.last_seen_at < now() - interval '1 minute';

  return query
    select s.id, u.id, u.account_id, u.email, u.name, u.role, a.name, a.is_demo
      from auth_sessions s
      join users u on u.id = s.user_id
      join accounts a on a.id = u.account_id
     where s.token_hash = p_token_hash
       and s.revoked_at is null
       and s.expires_at > now();
end $$;

create or replace function app.revoke_session(p_token_hash text) returns void
  language sql security definer
  set search_path = public, app
  as $$
    update auth_sessions set revoked_at = now()
     where token_hash = p_token_hash and revoked_at is null
  $$;

-- Encerra as OUTRAS sessões do usuário (mantém a atual).
create or replace function app.revoke_other_sessions(p_user_id uuid, p_keep_token_hash text) returns integer
  language plpgsql security definer
  set search_path = public, app
  as $$
declare n integer;
begin
  update auth_sessions set revoked_at = now()
   where user_id = p_user_id and token_hash <> p_keep_token_hash and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.list_sessions(p_user_id uuid)
  returns table (id uuid, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, user_agent text, token_hash text)
  language sql security definer stable
  set search_path = public, app
  as $$
    select s.id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent, s.token_hash
      from auth_sessions s
     where s.user_id = p_user_id and s.revoked_at is null and s.expires_at > now()
     order by s.last_seen_at desc
  $$;

-- Perfil: nome e senha. Troca de senha exige reautenticação (verificada no app
-- pelo hash atual, que esta função devolve só para o próprio usuário).
create or replace function app.password_hash_of(p_user_id uuid) returns text
  language sql security definer stable
  set search_path = public, app
  as $$ select password_hash from users where id = p_user_id $$;

create or replace function app.update_profile(p_user_id uuid, p_name text) returns void
  language sql security definer
  set search_path = public, app
  as $$ update users set name = p_name where id = p_user_id $$;

create or replace function app.update_password(p_user_id uuid, p_hash text) returns void
  language sql security definer
  set search_path = public, app
  as $$ update users set password_hash = p_hash where id = p_user_id $$;

revoke all on function app.find_user_for_login(text) from public;
revoke all on function app.create_session(uuid, text, timestamptz, text, text) from public;
revoke all on function app.find_user_for_session(text) from public;
revoke all on function app.revoke_session(text) from public;
revoke all on function app.revoke_other_sessions(uuid, text) from public;
revoke all on function app.list_sessions(uuid) from public;
revoke all on function app.password_hash_of(uuid) from public;
revoke all on function app.update_profile(uuid, text) from public;
revoke all on function app.update_password(uuid, text) from public;

grant execute on function app.find_user_for_login(text) to app_web;
grant execute on function app.create_session(uuid, text, timestamptz, text, text) to app_web;
grant execute on function app.find_user_for_session(text) to app_web;
grant execute on function app.revoke_session(text) to app_web;
grant execute on function app.revoke_other_sessions(uuid, text) to app_web;
grant execute on function app.list_sessions(uuid) to app_web;
grant execute on function app.password_hash_of(uuid) to app_web;
grant execute on function app.update_profile(uuid, text) to app_web;
grant execute on function app.update_password(uuid, text) to app_web;

-- ───────────────────────── app_worker (Fase 2 consome) ─────────────────────────

grant select on sites to app_worker;
grant select, update on monitors to app_worker;
grant select, insert, update on worker_heartbeats to app_worker;

create policy sites_worker    on sites    for select to app_worker using (archived_at is null);
create policy monitors_worker on monitors for all    to app_worker using (true) with check (true);
