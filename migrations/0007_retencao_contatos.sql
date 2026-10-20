-- Fase 5 — exclusão e retenção de contatos.
--
-- Excluir um contato NÃO apaga a linha: anonimiza. Identidades somem, o nome
-- some, os campos dos envios viram {} — e as contagens, horários, páginas e
-- atribuições do relatório continuam exatamente iguais. O dado pessoal sai; o
-- fato de que houve um contato naquele dia fica.
--
-- A política de retenção é por site e é decisão do proprietário: 'manual'
-- (padrão) mantém até alguém excluir; 'dias' manda o worker anonimizar quem
-- não tem contato real há N dias (30 a 3650).

-- ───────────────────────── política por site ─────────────────────────

alter table site_tracking
  add column contact_retention_policy text    not null default 'manual'
                                       check (contact_retention_policy in ('manual', 'dias')),
  add column contact_retention_days   integer check (contact_retention_days is null or contact_retention_days between 30 and 3650),
  -- Política automática sem prazo não existe: o banco recusa.
  add constraint site_tracking_retention_coerente
    check (contact_retention_policy <> 'dias' or contact_retention_days is not null);

-- ───────────────────────── marcas de anonimização ─────────────────────────

alter table contacts
  add column anonymized_at   timestamptz,
  add column deletion_reason text check (deletion_reason is null or deletion_reason in ('manual', 'retencao'));

-- A varredura do worker procura, por site, quem está vencido e ainda não foi anonimizado.
create index contacts_retencao_idx on contacts (site_id, last_real_at) where anonymized_at is null;

-- ───────────────────────── permissões ─────────────────────────
--
-- app_web (a central): já tinha a política tenant "for all" nestas tabelas;
-- faltavam os GRANTs de escrita que a anonimização usa. Em `submissions` e
-- `contact_identities` o grant de update é POR COLUNA: a central continua sem
-- poder tocar em `receipt_status` — "destino confirmado" só nasce do webhook.
--   · contact_id em submissions/contact_identities: usado também pela mesclagem
--     explícita de conflitos ("mesma pessoa"), que até aqui esbarrava em
--     "permission denied".

grant delete on contact_identities to app_web;
grant update (contact_id) on contact_identities to app_web;
grant update (contact_id, fields) on submissions to app_web;

-- app_worker (retenção automática): o mínimo para anonimizar SEM nunca ler um
-- nome, e-mail ou telefone. Seleção por coluna: `contacts.name` e
-- `contact_identities.value` ficam fora do alcance do papel.

grant select on site_tracking to app_worker;
grant select (id, account_id, site_id, first_real_at, last_real_at, created_at, deleted_at, anonymized_at, deletion_reason),
      update (name, deleted_at, anonymized_at, deletion_reason)
   on contacts to app_worker;
grant select (id, account_id, site_id, contact_id, kind, created_at), delete on contact_identities to app_worker;
grant update (fields) on submissions to app_worker;
grant select, update (resolved_at, resolution) on contact_conflicts to app_worker;

create policy tracking_worker    on site_tracking      for select to app_worker using (true);
create policy contacts_worker    on contacts           for all    to app_worker using (true) with check (true);
create policy identities_worker  on contact_identities for all    to app_worker using (true) with check (true);
create policy conflicts_worker   on contact_conflicts  for all    to app_worker using (true) with check (true);
-- `submissions_worker` (0005) cobre só SELECT; UPDATE precisa de política própria.
create policy submissions_worker_update on submissions for update to app_worker using (true) with check (true);

-- ───────────────────────── RLS em toda tabela ─────────────────────────
--
-- `worker_heartbeats` era a única tabela de aplicação sem RLS. Não tem conta
-- (é saúde do próprio sistema), mas a auditoria de permissões afirma "toda
-- tabela tem RLS ativa e forçada" — e uma exceção sem política é o lugar onde
-- a próxima tabela sem RLS passa despercebida. Políticas permissivas por
-- papel: o comportamento não muda.

alter table worker_heartbeats enable row level security;
alter table worker_heartbeats force row level security;
create policy heartbeats_web    on worker_heartbeats for select to app_web    using (true);
create policy heartbeats_worker on worker_heartbeats for all    to app_worker using (true) with check (true);
