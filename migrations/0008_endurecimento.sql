-- Endurecimento pós-revisão da Fase 5.
--
-- 1) app_worker lia `submissions` inteira (inclusive `fields`: nome, e-mail,
--    telefone e mensagem de todas as contas) por herança do grant de tabela da
--    0005. A retenção só precisa localizar envios de um contato e zerar `fields`:
--    seleção por coluna, SEM `fields`.
--    (`update (fields)` concedido na 0007 continua valendo.)
revoke select on submissions from app_worker;
grant select (id, account_id, site_id, contact_id, session_id) on submissions to app_worker;

-- 2) Retenção de sessões: acompanham os eventos (90 dias). O worker precisa ler
--    `sessions` (sem PII relevante: origem, dispositivo, chaves opacas) e apagar.
--    Sessões que ainda têm envio associado são preservadas (as origens dos contatos).
grant select, delete on sessions to app_worker;
create policy sessions_worker on sessions for all to app_worker using (true) with check (true);
