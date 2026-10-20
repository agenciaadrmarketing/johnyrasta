-- Recuperação de senha por e-mail (Fase 6).
-- O token vai por e-mail; o banco guarda só o SHA-256. A tabela não é acessível
-- ao app_web: tudo passa por funções SECURITY DEFINER estreitas, como o login.

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references users(id) on delete cascade,
  token_hash  text        not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index password_resets_user_idx on password_resets (user_id, created_at desc);
alter table password_resets enable row level security;
alter table password_resets force row level security;

-- Cria o pedido. Devolve o usuário só quando criou; no máximo 3 pedidos por hora
-- por usuário (devolve vazio além disso). O chamador responde igual nos dois casos.
create or replace function app.request_password_reset(p_email text, p_token_hash text, p_expires_at timestamptz)
  returns table (user_id uuid, email text, name text)
  language plpgsql security definer
  set search_path = public, app
  as $$
declare u record;
begin
  select x.id, x.email, x.name into u from users x where lower(x.email) = lower(p_email);
  if not found then return; end if;
  if (select count(*) from password_resets r where r.user_id = u.id and r.created_at > now() - interval '1 hour') >= 3 then return; end if;
  insert into password_resets (user_id, token_hash, expires_at) values (u.id, p_token_hash, p_expires_at);
  return query select u.id, u.email, u.name;
end $$;

-- A página de redefinição só mostra o formulário para um token que ainda vale.
create or replace function app.password_reset_valid(p_token_hash text) returns boolean
  language sql security definer stable
  set search_path = public, app
  as $$ select exists (select 1 from password_resets where token_hash = p_token_hash and used_at is null and expires_at > now()) $$;

-- Consome o token (uso único), troca a senha e encerra TODAS as sessões do usuário.
create or replace function app.consume_password_reset(p_token_hash text, p_new_hash text)
  returns table (user_id uuid, account_id uuid)
  language plpgsql security definer
  set search_path = public, app
  as $$
declare uid uuid;
begin
  update password_resets set used_at = now()
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   returning password_resets.user_id into uid;
  if uid is null then return; end if;
  update users set password_hash = p_new_hash where id = uid;
  update auth_sessions set revoked_at = now() where auth_sessions.user_id = uid and revoked_at is null;
  update password_resets set used_at = now() where password_resets.user_id = uid and used_at is null;
  return query select u.id, u.account_id from users u where u.id = uid;
end $$;

revoke all on function app.request_password_reset(text, text, timestamptz) from public;
revoke all on function app.password_reset_valid(text) from public;
revoke all on function app.consume_password_reset(text, text) from public;
grant execute on function app.request_password_reset(text, text, timestamptz) to app_web;
grant execute on function app.password_reset_valid(text) to app_web;
grant execute on function app.consume_password_reset(text, text) to app_web;

-- Retenção: o worker apaga pedidos vencidos há mais de um dia.
grant select, delete on password_resets to app_worker;
create policy password_resets_worker on password_resets for all to app_worker using (true) with check (true);
