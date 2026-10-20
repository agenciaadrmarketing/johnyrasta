-- Alerta automático de regressão de PageSpeed confirmada (Fase 6).
alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in (
  'incidente_confirmado', 'incidente_recuperado', 'verificacao_atrasada',
  'tls_vencendo', 'tls_falha', 'coletor_parado', 'fila_parada', 'regressao_pagespeed'));
-- Contas que já existem não ganham o novo tipo sozinhas: é escolha delas (D78).
alter table notification_settings alter column kinds set default array[
  'incidente_confirmado', 'incidente_recuperado', 'tls_vencendo', 'tls_falha',
  'verificacao_atrasada', 'coletor_parado', 'fila_parada', 'regressao_pagespeed'];
