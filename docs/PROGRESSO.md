# Progresso — JohnyWeb V2

## Fase 5 — Relatórios, notificações e lançamento (20/10/2026)

### Implementado e verificado localmente
- **Relatórios**: `/relatorios` (seleção de cliente ou site e período 7/30/90 ou personalizado), `/relatorios/site/<id>` e `/relatorios/cliente/<id>` com cabeçalho de período e fuso, seções de disponibilidade, velocidade, audiência, ações, contatos e horários, fonte e limitação por seção, botão de impressão e links de CSV; impressão pelo navegador com tokens remapeados e quebra entre sites. O relatório compõe as funções das abas, sem SQL próprio.
- **Notificações**: migração `0006_notificacoes.sql` (preferências da conta, preferência por site, outbox de entregas com unicidade por alerta, canal e destinatário), adaptador de e-mail no worker (Resend, Postmark, webhook genérico e modo de log), outbox com retentativas e backoff, seção Notificações em Configurações (destinatários, tipos, estado do provedor na aplicação e no worker, últimas entregas), painel por site em Disponibilidade.
- **Contatos**: migração `0007_retencao_contatos.sql`, exclusão por anonimização na aba Contatos, política de retenção por site (manual ou N dias) aplicada pelo worker de hora em hora, grants por coluna para o worker não ler dado pessoal.
- **Permissões**: matriz declarada de grants, RLS e funções em `tests/integration/permissoes.spec.ts`; e2e cruzado em `tests/e2e/permissoes.spec.ts` (todas as telas do site e exportações de outra conta → 404; sem sessão → 401). Defeito de grant da mesclagem de conflitos (Fase 4) encontrado e corrigido.
- **Operação**: `npm run db:backup` e `npm run db:restaurar` com verificação estrutural e de contagens; `docs/BACKUP.md` (com restauração demonstrada), `docs/IMPLANTACAO.md`, `docs/INSTALACAO-NO-SITE.md`, `docs/CHECKLIST-PRE-PRODUCAO.md`.

### Aceite da Fase 5
- **Relatório e tela usam os mesmos cálculos**: `tests/integration/relatorio.spec.ts` compara `relatorioDoSite` campo a campo com as funções das abas para o mesmo período (R01), inclusive fronteira de fuso e exclusão de diagnóstico.
- **Alerta não se repete indevidamente**: `tests/integration/outbox.spec.ts` (um alerta → uma entrega por destinatário após dez rodadas; retentativa só para transitórios; 4xx definitivo; preferência por site; corte temporal).
- **Restauração de backup demonstrada**: executada no ambiente local e registrada em `docs/BACKUP.md`; `tests/integration/backup.spec.ts` repete o ciclo contra o banco de teste.
- **Build e testes passam**: ver o resumo final desta fase abaixo.
- **Limitações documentadas**: no relatório (seção própria), em `docs/IMPLANTACAO.md` e em `docs/BACKUP.md`.

### Depende de credencial ou ambiente
- Envio real de e-mail (chave de Resend/Postmark ou URL de webhook) e `APP_URL` público para os links.
- Medição real do PageSpeed (chave), piloto num site real, monitor externo da própria central, bloqueio de egress do worker, agendamento do backup e envio para armazenamento externo.

### Não feito nesta fase
- Recuperação de senha e troca de e-mail por confirmação (exigem provedor; o adaptador agora existe, falta o fluxo).
- Alerta automático de regressão de PageSpeed confirmada; fração de checagens bem-sucedidas num período exato do passado (o relatório declara a janela a partir de agora).
- Portal de cliente leitor; importação de dados da V1.

## Fase 4 — Eventos, botões e contatos (20/10/2026)

### Implementado e verificado localmente
- Migração `0005_eventos_e_contatos.sql`: configuração de coleta por site, sessões, eventos, contatos, identidades, submissões, conflitos, nonces de webhook, sessões de diagnóstico; papéis `app_ingest` e `app_forms`.
- Coletor `public/c.v1.js` (ES5, versionado): visitas com rotas SPA, cliques por `data-track-id`/`data-track-pos`/`data-track-kind` e detecção automática, `form_attempt`, UTMs permitidas, consentimento opcional, modo de teste por token, envio por beacon/keepalive.
- Endpoints públicos: `POST /api/collect` (lote, 204 após persistir, limites de bytes e requisições), `POST /api/forms/<publicId>` (endpoint ou `?mode=auxiliar`, JSON ou form-urlencoded, honeypot), `POST /api/forms/<publicId>/confirmar` (webhook assinado com replay protection).
- Serviços: ingestão com dedupe antes de efeitos, sessões de 30 min, recepção com idempotência, reconciliação de identidades com conflito, atribuição ao último clique, diagnóstico isolado.
- Central: aba Instalação (configuração, snippets HTML/React/WordPress, marcação de botões, três modos de formulário com instruções, segredo de webhook mostrado uma vez, teste com token e evidências), aba Contatos (lista, envios com origem da evidência, conflitos com decisão explícita, CSV), aba Botões e horários (barras por hora com alternativa textual, dias da semana, origens, tabela de botões com denominador compatível, aviso de amostra pequena, CSV), Resumo com estado real.
- Worker: retenção (eventos 90 dias, medições 12 meses) e alerta de coleta interrompida.
- Página pública `/teste/<publicId>` com o coletor real para prova de instalação.

### Aceite da Fase 4
- **Visita e clique reais em site de teste aparecem**: e2e `fase4.spec.ts` abre a página de teste com o coletor real, clica, envia o formulário e confere em Botões e Contatos.
- **Submissão gera contato; reenvio não duplica**: integração F01 e e2e pela API pública.
- **Falha do destino externo não vira sucesso confirmado**: integração F02 (modo auxiliar) e webhook (só assinatura válida confirma).
- **Eventos de teste não mudam KPI**: integração F04 e e2e (diagnóstico primeiro, KPIs vazios; depois real).
- E01–E04, F03, T01–T03 cobertos em unidade e integração.

### Pendente
- Instalação piloto num site real da carteira (depende de um site autorizado e do domínio público da central).
- Alerta `coletor_parado` depende de 8 dias de histórico para disparar; não há como validar ao vivo hoje.
- Exclusão e política de retenção de contatos (Fase 5).

## Fase 3 — PageSpeed (19/10/2026)

### Implementado e verificado localmente
- Migração `0004_velocidade.sql`: `monitored_urls` (até 3 por site, dispositivos, frequência), `audit_jobs` (fila genérica com lease e chave única por trabalho ativo), `performance_runs`, `crux_snapshots`; RLS e grants.
- Worker: agenda diária (idempotente por dia), consumidor com lease, chamada à API v5 com timeout, classificação de erros (cota, timeout, página inacessível, bloqueado, parcial), retentativas com backoff, gravação separada de laboratório e campo, marcação de possível regressão, alerta de fila parada.
- Central: aba Velocidade (URLs do próprio domínio, mobile/desktop, medir agora com cooldown, última medição por série com notas e LCP/CLS/TBT, CrUX com escopo URL/origem e INP, oportunidades sem soma, histórico), Resumo e Configurações com estado da integração e da fila.

### Aceite da Fase 3
- **Simulações de 429/timeout não geram nota falsa**: `pagespeed-fila.spec.ts` (P01) contra o Postgres com API substituída — 429 vira retentativa com backoff, nada gravado; depois mede.
- **Mesma URL em mobile e desktop = duas séries**: P02 na agenda e na gravação.
- **CrUX sem volume = "dados insuficientes"**: P03 (resposta sem campo não cria snapshot; a tela mostra o estado).
- **Fila drena sem interface aberta**: consumidor roda no worker; lease retomado após vencimento testado.
- **Medição real autorizada nos dois dispositivos**: **NÃO executada** — não há chave do PageSpeed neste ambiente. O código chama a API real (`urlDaApi`) e foi exercitado com respostas gravadas no formato da v5. Pendente: informar `PAGESPEED_API_KEY` e autorizar uma URL para validar ao vivo.

### Pendente
- Validação ao vivo com chave real (depende de credencial).
- Alerta automático de regressão confirmada (duas medições comparáveis).
- Retenção de 12 meses de medições (worker apaga; a regra está documentada, o job de retenção entra junto com o de eventos na Fase 4).

## Fase 2 — Disponibilidade e operação (19/10/2026)

### Implementado e verificado localmente
- Migração `0003_disponibilidade.sql`: lease nos monitores, `checks`, `incidents` (um aberto por monitor), `alerts` (dedupe por chave), RLS e grants para `app_web` e `app_worker`.
- Worker completo: fila com lease (`FOR UPDATE SKIP LOCKED`), verificador HTTP seguro (política de rede, DNS fixado, revalidação em redirects, timeout global, limite de bytes, TLS verificado com expiração lida do socket), máquina de estados, alertas, retenção de 30 dias, heartbeat com estado da fila.
- Central: aba Disponibilidade (estado, última/próxima checagem, TLS, manutenção, pausar/retomar, verificar agora com cooldown, "checagens bem-sucedidas" com amostras e lacunas, incidentes com duração observada, últimas 50 checagens, alertas do site); Atenção com alertas abertos (resolver/silenciar) e decisões pendentes; Resumo com estado real e atividade recente; Configurações com estado da fila.
- Situação do site (linha, resumo, Atenção) agora vem de fatos reais: última checagem, incidente aberto, recuperação recente, manutenção, atraso.

### Aceite da Fase 2 (executado)
- **Servidor de teste 200 → 500 → confirmação → recuperação**: executado de duas formas. (1) Integração com o Postgres real e verificador substituído (`tests/integration/fluxo-disponibilidade.spec.ts`): 1 incidente, confirmação na 2ª falha, 1 alerta após 10 falhas, recuperação com alerta próprio e abertura resolvida, falha isolada, atraso, manutenção. (2) **Ao vivo**: servidor local na porta 80 (`piloto.exemplo.test` em `/etc/hosts`), worker real com `MONITOR_EXCECOES_DE_REDE=127.0.0.1`, estados alternados por arquivo; mesmo resultado observado no banco e nas telas.
- **Worker reinicia sem duplicar**: lease (U07) e dois workers concorrentes (SKIP LOCKED) testados.
- **Parada do worker mostra atraso**: U03 em unidade (estado) e integração (alerta de atraso).
- **Destino privado bloqueado**: U04 em unidade (faixas) e integração (redirect para 10.0.0.1, host que resolve para privado, porta alta em nome público). U05 (DNS fixado), U06 (certificado não confiável), U08 (lento, enorme, loop de redirects, DNS lento) em integração.

### Testes
- Unidade: política de rede (IPv4, IPv6, mapeado, NAT64, URL), máquina de estados (U01, U02, N01, lacuna, manutenção, faixas TLS).
- Integração: verificador contra servidores locais HTTP e HTTPS (certificado gerado com openssl), fluxo completo contra o Postgres, lease, concorrência, permissões do papel do worker.
- Navegador: suíte da Fase 1 continua verde contra o build com a Fase 2.

### Pendente
- Alerta de "fila parada" por PageSpeed e "coletor parado" (Fases 3 e 4). E-mail (Fase 5).
- Bloqueio de egress na hospedagem (segunda camada): configuração de infraestrutura, não de código.
- Monitor externo independente da própria central.

## Fase 1 — Fundação e central de sites (19/10/2026)

### Implementado e verificado localmente
- Projeto novo (Next.js 16, React 19, TypeScript 5, PostgreSQL 16), build de produção passando.
- Banco: `migrations/0001_fundacao.sql` (contas, usuários, sessões, clientes, sites, favoritos, monitores, heartbeat, auditoria) e `0002_rls_e_papeis.sql` (RLS forçada, papéis `app_web` e `app_worker`, funções de autenticação).
- Scripts: `db:setup` (database + papéis + migrações), `db:migrate`, `db:bootstrap` (proprietário sem senha padrão), `db:demo` (conta de demonstração isolada e identificada).
- Autenticação: login com scrypt, sessão opaca no banco, logout, troca de senha com reautenticação, lista e encerramento de sessões, trilha de auditoria.
- Carteira: criar/editar/arquivar clientes e sites, favoritos, busca por nome/cliente/domínio, filtros (Todos, Atenção, Favoritos, Arquivados), normalização de URL/domínio, unicidade por conta.
- Telas: Entrar, Meus sites, Adicionar/Editar site, Espaço do site (Resumo + 5 abas com estado explícito), Atenção, Clientes (lista, novo, detalhe), Relatórios (estado "aguardando dados"), Configurações (sistema, perfil, senha, sessões), Referência de componentes nos dois temas, 404/500 com a moldura Matrix.
- Design system Matrix portado (tokens, fontes, efeitos, controles de aparência) e verificador `npm run design` passando.
- Worker: processo separado com heartbeat; a central mostra "nunca visto"/"sem sinal"/"ativo".
- Segurança: CSP com nonce em produção, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy.

### Testes
- Unidade (vitest): máquina de estados da situação, validação de site/cliente, fusos, formato de tempo (meia-noite UTC), senha.
- Integração (vitest + PostgreSQL real, banco `johnyweb_test` recriado a cada execução): A01, A02, chave composta, `with check`, unicidade de domínio por conta, domínio normalizado, um monitor por site, sessões (criar/validar/revogar/encerrar outras), `app_web` sem acesso direto a `auth_sessions`.
- Navegador (Playwright, contra `next start`): redirecionamento sem sessão, login com erro único, cadastro cliente→site→busca, domínio duplicado, A01 por URL (404) e por busca, V02 (sem KPIs na abertura), estado do worker, V03 (reduced motion), teclado, referência nos dois temas, celular sem rolagem horizontal e com quatro destinos.

### Como rodar
Veja `docs/OPERACAO.md`. Resumo: `cp .env.example .env.local` → preencher → `npm run db:setup` → `npm run db:bootstrap` → `npm run dev` e, em outro terminal, `npm run worker`.

### Pendente (por fase)
- **Depende de credencial/ambiente**: chave PageSpeed, provedor de e-mail, hospedagem com processo contínuo para o worker, monitor externo independente da própria central.
- **Não feito nesta fase**: recuperação de senha por e-mail; convite de outros usuários pela interface; importação de dados da V1.
