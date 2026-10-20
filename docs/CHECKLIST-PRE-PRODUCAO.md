# Checklist pré-produção

Cada item diz **como conferir**. Marque só o que foi visto, não o que "deveria estar". Ordem recomendada; os blocos dependem dos anteriores.

## Código

- [ ] `npm ci` limpo na versão de Node da hospedagem (20+; desenvolvido com 22). *Conferir*: `node -v`; `npm ci` sem erro.
- [ ] `npm run verificar` verde: typecheck, lint (zero erros e zero avisos), design (`npm run design`), unidade e integração. *Conferir*: código de saída 0; integração exige um PostgreSQL de teste e recria `johnyweb_test` (ou `TEST_DB_NAME`).
- [ ] `npm run build` verde na mesma versão de Node. *Conferir*: saída do build sem erro; `npm start` sobe.
- [ ] Suíte de navegador contra o build (`npm run test:e2e`) verde pelo menos uma vez no ambiente de homologação. *Conferir*: relatório do Playwright.
- [ ] Versão a publicar está identificada (tag ou commit) e é a mesma na web e no worker. *Conferir*: `git describe`/hash nos dois serviços.

## Banco

- [ ] PostgreSQL 14+ (16 recomendado) com TLS; URLs remotas com `?sslmode=require`; `DATABASE_SSL_CA` definido quando o provedor publica a raiz. *Conferir*: `select version();`; conexão sem TLS recusada pelo provedor.
- [ ] `npm run db:setup` executado com `DATABASE_URL_ADMIN` a partir da máquina de operação; `schema_migrations` tem todas as versões de `migrations/`. *Conferir*: `select version from schema_migrations order by 1;` × `ls migrations/`.
- [ ] Quatro papéis com **senhas próprias e diferentes** entre si e da administrativa: `app_web`, `app_worker`, `app_ingest`, `app_forms`. *Conferir*: `select rolname, rolcanlogin from pg_roles where rolname like 'app\_%';` — quatro linhas com `t`; nenhuma URL repete senha.
- [ ] Nenhum papel da aplicação é superusuário nem dono das tabelas. *Conferir*: `select rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname like 'app\_%';` — tudo `f`; `select tableowner from pg_tables where schemaname = 'public' group by 1;` — só o administrador.
- [ ] RLS forçada em todas as tabelas de negócio. *Conferir*: `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity;` — só `schema_migrations` e `worker_heartbeats`.
- [ ] Prova de isolamento no banco de produção vazio: como `app_web`, `select count(*) from sites;` → 0; `select count(*) from auth_sessions;` → permissão negada. Como `app_ingest`, `select count(*) from contacts;` → permissão negada.
- [ ] `DATABASE_URL_ADMIN` **não** está no ambiente da web nem do worker. *Conferir*: painel de variáveis dos dois serviços.

## Variáveis por serviço

- [ ] **Web**: `DATABASE_URL`, `DATABASE_URL_INGEST`, `DATABASE_URL_FORMS`, `SESSION_SECRET` (≥ 32 caracteres, gerado por `openssl rand -base64 48`, nunca reutilizado de outro ambiente), `APP_URL` (https, domínio público, sem barra final), `NODE_ENV=production`. *Conferir*: Configurações mostra "Banco de dados: conectado como app_web".
- [ ] **Worker**: `DATABASE_URL_WORKER`, `WORKER_ID` (um por instância), `MONITOR_CONCORRENCIA` dimensionada (`docs/IMPLANTACAO.md`), `MONITOR_EXCECOES_DE_REDE` **vazia**. *Conferir*: log de início do worker diz `Exceções de rede: nenhuma` e não mostra o aviso de IPs privados liberados.
- [ ] **Scripts/operação**: `DATABASE_URL_ADMIN`, `BACKUP_DIR` (fora do diretório do projeto), `PG_BIN` se necessário. *Conferir*: `npm run db:backup` funciona a partir dessa máquina.
- [ ] Nenhuma variável de `BOOTSTRAP_*` ficou no ambiente depois do bootstrap. *Conferir*: painel de variáveis.
- [ ] `.env.example` continua sem valores reais; segredos só no gestor da hospedagem. *Conferir*: `git grep -n 'postgres://' .env.example` só mostra exemplos com `troque-esta-senha`/`postgres:postgres@localhost`.

## Web no ar

- [ ] `APP_URL/entrar` responde 200 por HTTPS, com cabeçalhos `Content-Security-Policy` (com nonce), `Strict-Transport-Security`, `X-Frame-Options: DENY`. *Conferir*: `curl -sI https://…/entrar`.
- [ ] Todos os subdomínios do domínio da central servem HTTPS (HSTS com `includeSubDomains`). *Conferir*: lista de registros DNS × certificados.
- [ ] Proxy reverso repassa `X-Forwarded-For`, `Host` e `Origin` sem reescrever. *Conferir*: login funciona (checagem de origem); `select ip from auth_sessions order by created_at desc limit 3;` mostra o IP real do operador, não o do proxy.
- [ ] Login do proprietário funciona; troca de senha funciona; "encerrar outras sessões" funciona. *Conferir*: fazer cada um uma vez.
- [ ] `APP_URL/c.v1.js` responde `application/javascript` com `Access-Control-Allow-Origin: *`. *Conferir*: `curl -sI https://…/c.v1.js`.
- [ ] Snippets da aba Instalação de um site mostram `APP_URL` público (não `localhost`). *Conferir*: abrir a aba.

## Worker

- [ ] Processo supervisionado com restart automático e parada por `SIGTERM` (systemd, container com restart policy ou worker de plataforma). *Conferir*: matar o processo e vê-lo voltar em segundos.
- [ ] Visto em **Configurações**: "Worker: ativo · visto há poucos segundos" com o `WORKER_ID` esperado e a versão. *Conferir*: tela.
- [ ] Depois de 5 minutos parado, Configurações mostra "sem sinal" e os sites monitorados "verificação atrasada". *Conferir*: parar o worker em homologação por 6 min e olhar.
- [ ] Bloqueio de egress para redes privadas e metadata (`169.254.169.254`) ativo no host do worker. *Conferir*: do host do worker, `curl -m 3 http://169.254.169.254/` e `curl -m 3 http://10.0.0.1/` falham por rede, não por timeout da aplicação.
- [ ] Egress liberado para portas 80/443 da internet e para `www.googleapis.com`. *Conferir*: `curl -sI https://www.googleapis.com/` do host.
- [ ] Um site de teste monitorado: ciclo 200 → 500 → confirmado → recuperado observado na aba Disponibilidade e em Atenção (procedimento em `docs/OPERACAO.md`). *Conferir*: dois alertas (abertura e recuperação).

## Integrações: configuradas OU explicitamente "não configuradas"

- [ ] **PageSpeed**: `PAGESPEED_API_KEY` definida **na web e no worker** com uma medição real concluída em mobile e desktop para uma URL autorizada — OU ausente dos dois, com Configurações e a aba Velocidade mostrando "não configurado" (nunca uma nota). *Conferir*: tela; log do worker (`PageSpeed configurado` ou `NÃO configurado`).
- [ ] **E-mail**: provedor configurado e um alerta de teste entregue — OU "não configurado" aceito, com a operação ciente de que alertas vivem só na tela de Atenção e no monitor externo. *Conferir*: Configurações.
- [ ] **Monitor externo** da própria central apontando para `APP_URL/entrar`, com alerta para o operador, e um teste de falha simulado (derrubar a web por 5 min em homologação). *Conferir*: alerta recebido.

## Backup

- [ ] `npm run db:backup` agendado (diário) na máquina de operação, com envio para armazenamento externo e retenção de 30 dias. *Conferir*: dois arquivos de dias diferentes no destino externo.
- [ ] Restauração testada **a partir do arquivo do armazenamento externo**: `npm run db:restaurar -- --para johnyweb_teste_restauracao --arquivo <arquivo>` com verificação "estrutura íntegra" e contagens iguais (ou diferentes só em tabelas vivas). *Conferir*: saída colada na tabela de `docs/BACKUP.md`; banco de teste apagado depois.
- [ ] Backup feito **imediatamente antes** da migração mais recente aplicada em produção. *Conferir*: data do arquivo × `applied_at` em `schema_migrations`.
- [ ] Backups do provedor (snapshot/PITR) ligados, se disponíveis. *Conferir*: painel do provedor.

## Dados e conta

- [ ] **Conta de demonstração ausente**: `select count(*) from accounts where is_demo;` → 0. `DEMO_MODE` indefinido. `npm run db:demo` nunca rodou em produção.
- [ ] Nenhuma conta de teste (`e2e-a`, `e2e-b`, `*.local`): `select email from users where email like '%@teste.local' or email like '%.local';` → vazio.
- [ ] Apenas o proprietário real existe; e-mail e nome corretos. *Conferir*: `select email, name, role from users;`.
- [ ] `audit_log` registra as ações feitas na conferência (criação de cliente/site, troca de senha). *Conferir*: `select action, created_at from audit_log order by created_at desc limit 10;`.

## Piloto antes da carteira

- [ ] **Um** site real instalado conforme `docs/INSTALACAO-NO-SITE.md`: teste com token com **Visita**, **Clique** e **Formulário** confirmados.
- [ ] Primeiro evento real chegou ("Script medindo: Confirmado") e um contato real apareceu na aba Contatos com a origem da evidência correta para o modo escolhido.
- [ ] Botões marcados aparecem com os nomes esperados em Botões e horários; horários no fuso do site.
- [ ] Tag antiga (`/t.js`) removida do site piloto; nenhum clique duplicado em 24 h.
- [ ] Só então cadastrar os demais sites — em lotes, conferindo a fila em Configurações a cada lote (sem "atrasados").

## Rollback ensaiado

- [ ] Procedimento escrito e à mão: voltar a versão anterior da web e do worker **juntos**, sem tocar no banco (migrações são aditivas).
- [ ] Ensaio feito em homologação: publicar versão N, aplicar migração, voltar para N−1, confirmar que a aplicação funciona com o schema novo.
- [ ] Procedimento de promoção de banco restaurado lido e entendido (`docs/BACKUP.md`): restaurar **num banco novo**, trocar as cinco URLs, nunca por cima do banco em uso.
- [ ] Quem é chamado, por qual canal, quando o monitor externo alertar fora do horário. *Conferir*: nome e telefone escritos, não "a equipe".
