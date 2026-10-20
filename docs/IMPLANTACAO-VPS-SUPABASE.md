# Implantação: VPS (Next.js + worker) e banco no Supabase

Estado: **preparada, não executada**. Nada foi contratado, nenhum DNS alterado e nenhuma migração rodou em produção. O que foi **testado** está marcado como tal; o que depende do painel do Supabase, da Hostinger ou do DNS está marcado **[depende da infraestrutura]**. Este documento complementa `docs/ROTEIRO-PILOTO.md` (piloto), `docs/COMPATIBILIDADE.md` (retorno de versão) e `docs/BACKUP.md`.

## 0. Pontos de atenção antes de tudo

1. **"Hostinger Premium" é hospedagem compartilhada**: não mantém um processo contínuo como o worker, nem roda `next start` com controle de processo. Para esta arquitetura é preciso um **plano VPS** da Hostinger (ou de outro provedor). A contratação é sua; este roteiro vale para qualquer VPS Ubuntu. Se a VPS tiver data center no Brasil, escolha-o: a **distância até o banco é o que mais pesa na lentidão** (seção 5).
2. **O Supabase vai ser só PostgreSQL.** A central tem login, sessões e autorização próprios (RLS por conta, papéis `app_*`). Não use Supabase Auth, Storage, PostgREST nem as chaves `anon`/`service_role`. Isso evita expor a API de dados do Supabase às tabelas da central (seção 1.3).
3. **A V2 mantém conta, banco e domínio separados da V1.** Nada na V1 é tocado. O histórico dela só entra se você decidir (seção 8).

## 1. Compatibilidade com o PostgreSQL gerenciado do Supabase

### 1.1 O que foi testado (emulação local)
Não há acesso ao Supabase neste ambiente, então a compatibilidade foi **emulada** num cluster PostgreSQL 16 separado, com: administrador **sem superusuário** (`CREATEROLE`, `CREATEDB`, `BYPASSRLS`), banco já existente de propriedade dele, papéis `anon`/`authenticated`/`service_role` e **privilégios padrão do Supabase** concedendo tudo a esses três em tabelas, sequências e funções novas de `public`. Resultado:

| Verificação | Resultado |
|---|---|
| `db:setup` como administrador não-superusuário, com o banco já existente | **funciona**: cria os 4 papéis e aplica as migrações 0001–0010 |
| Suíte completa (214 testes: unidade, integração, RLS, permissões, backup/restauração) rodando com esse administrador | **214 de 214 passam** |
| Mesma suíte com administrador **sem** `BYPASSRLS` | **falha**: "violates row-level security policy" (RLS é *forçada*, vale até para o dono) |
| Concessões dos papéis do Supabase após migrar | **420 concessões** de `anon`/`authenticated` nas tabelas de `public` (herdadas dos privilégios padrão) |
| Após `db:supabase-endurecer` | **0** concessões; privilégios padrão zerados |
| Worker contra o banco emulado | conecta, grava heartbeat (`v2-fase6`) e encerra graciosamente no `SIGTERM` |

### 1.2 Adaptações feitas no código (e por quê)
- **`db:setup` não presume superusuário**: o banco já existe (`postgres`); se não existir e não puder ser criado, a mensagem explica. Papéis são criados por `CREATEROLE`. **Não** rode `db:setup -- --drop` num banco gerenciado.
- **Nome do papel × usuário do pooler.** No pooler do Supabase o usuário da URL é `papel.<ref do projeto>`. Sem tratamento, `db:setup` criaria um papel chamado `app_web.<ref>`. A variável `DB_ROLE_SUFFIX=<ref>` faz o script remover o sufixo (testado em unidade). O **mapeamento do pooler em si [depende da infraestrutura]** precisa ser conferido no primeiro uso: `db:supabase-preflight DATABASE_URL`.
- **TLS.** Antes, o `sslmode` da URL *sobrepunha* a configuração do código no `pg` e exigiria validar a cadeia com a CA do sistema (que não contém a do Supabase); o worker e os scripts nem aplicavam a política de TLS. Agora tudo passa por `src/shared/db/tls.ts`: `sslmode` é removido da URL, remoto sempre com TLS, e com `DATABASE_SSL_CA_FILE` (ou `DATABASE_SSL_CA`) a cadeia é **verificada**. Testado em unidade.
- **Pool configurável** (`DB_POOL_MAX`) e **registro de transações lentas** (`DB_LOG_LENTO_MS`).
- **Papéis do Supabase**: `scripts/supabase.ts endurecer` revoga de `anon`/`authenticated` o acesso a `public` (inclusive os privilégios padrão). Rode **depois de cada migração**.
- **`BYPASSRLS` do administrador** é obrigatório (bootstrap, importação, demo e `pg_restore`). O `preflight` confere. Se o seu administrador não o tiver **[depende do Supabase]**, é bloqueio: crie um papel administrador próprio com `BYPASSRLS` pelo SQL Editor.

### 1.3 O que continua a depender do Supabase
- Se o usuário `postgres` do projeto tem `CREATEROLE` e `BYPASSRLS` — **o `preflight` responde**.
- Se `pg_dump` pelo pooler em modo sessão funciona, e se existe espaço para um banco de restauração no mesmo projeto (`db:restaurar` cria outro database). Se não, restaure para um projeto/banco local de teste.
- `service_role` ignora a RLS. Mantenha essa chave fora do repositório, da VPS e de qualquer navegador; no painel, **desative a Data API** (PostgREST) do projeto se o plano permitir — a central não a usa.
- Limites do plano (conexões, armazenamento, pausa por inatividade, backups automáticos, retenção) **mudam por plano**: confira no painel antes de decidir; este documento não afirma valores.

## 2. Conexões: web, worker e migrações

Dados do painel do Supabase (Connect): host do pooler, ref do projeto e o certificado raiz **[depende da infraestrutura]**. Formato esperado (confirme no painel):

| Uso | Conexão | Modo | Por quê |
|---|---|---|---|
| Web: `DATABASE_URL`, `_INGEST`, `_FORMS` | `postgres://app_web.<ref>:SENHA@<host do pooler>:6543/postgres` | **transação** | muitas transações curtas; a central usa `begin` + `set_config(..., true)` + `commit` (escopo de transação), sem prepared statements nomeados e só travas `pg_advisory_xact_lock` — tudo compatível com pooler de transação |
| Worker: `DATABASE_URL_WORKER` | `postgres://app_worker.<ref>:SENHA@<host do pooler>:5432/postgres` | **sessão** | longa duração; evita qualquer dependência de sessão |
| Scripts: `DATABASE_URL_ADMIN` | `postgres://postgres.<ref>:SENHA@<host do pooler>:5432/postgres` | **sessão** | DDL, `pg_dump`/`pg_restore`, transações longas |

- **IPv4/IPv6.** A conexão **direta** (`db.<ref>.supabase.co`) é IPv6 apenas, salvo complemento IPv4 pago do Supabase; o **pooler** atende IPv4. A VPS pode ter só IPv4 ou IPv6 instável: por isso a recomendação é o **pooler**. `db:supabase-preflight` resolve o DNS e avisa. 
- **TLS**: baixe o certificado raiz do projeto, salve em `/etc/johnyweb/supabase-ca.crt` e use `DATABASE_SSL_CA_FILE`. Para `pg_dump`, use `?sslmode=require` na URL de ops (ou `verify-full` com o mesmo arquivo).
- **Pool.** 3 pools na web × `DB_POOL_MAX` (comece com 5 → 15 conexões de cliente) + 11 no worker. O pooler multiplexa; no modo sessão cada conexão do cliente ocupa uma do banco, então some ao limite do plano.
- **Verificação por URL:** `npm run db:supabase-preflight` (admin) e `npx tsx scripts/supabase.ts preflight DATABASE_URL` (e `DATABASE_URL_WORKER`). Ele avisa modo transação onde não deve, usuário sem `.<ref>`, host sem IPv4, papel com `BYPASSRLS` e a latência real de uma transação da central.

## 3. Configuração reproduzível (pasta `deploy/`)

| Arquivo | Para quê |
|---|---|
| `deploy/scripts/provisionar-vps.sh` | VPS Ubuntu nova: nginx, certbot, Node 22, usuário `johnyweb`, swap de 2 GB, firewall (SSH/HTTP/HTTPS), limite do journal (500 MB/30 dias) |
| `deploy/systemd/johnyweb-web.service`, `johnyweb-worker.service` | processos separados; `Restart=always`, sobem no boot (`enable`), logs no journal, teto de reinícios, `SIGTERM` gracioso no worker, limites de memória |
| `deploy/env/*.env.example` | variáveis por processo (**sem valores**), em `/etc/johnyweb/` com permissão 640 |
| `deploy/nginx/johnyweb.conf` | proxy para `127.0.0.1:3000`; **sobrescreve** `X-Forwarded-For` (o limite por IP depende disso); corpo máx. 64 KB |
| `deploy/scripts/deploy.sh <sha> [--migrar]` | release por commit em `/srv/johnyweb/releases/<sha>`, `current` por link simbólico; com `--migrar`: backup obrigatório → preflight → migrar → endurecer |
| `deploy/scripts/rollback.sh` | volta o link para o release anterior (web e worker juntos); só para commits verificados em `docs/COMPATIBILIDADE.md` |

Sequência (executada por você, na VPS, **depois** de contratada):
```bash
sudo bash deploy/scripts/provisionar-vps.sh          # uma vez
sudo -u johnyweb git clone <repositório> /srv/johnyweb/repo
sudo cp /srv/johnyweb/repo/deploy/env/*.example /etc/johnyweb/ && ...   # renomeie para web.env, worker.env, ops.env e preencha
sudo cp /srv/johnyweb/repo/deploy/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable johnyweb-web johnyweb-worker   # inicia no boot
# nginx + certbot (seção 6), depois:
sudo -u johnyweb /srv/johnyweb/repo/deploy/scripts/deploy.sh <SHA> --migrar     # primeira vez: banco novo
```
Logs: `journalctl -u johnyweb-web -f`, `journalctl -u johnyweb-worker -f`. Boot: o `enable` + `Restart=always` cobrem queda e reinício do servidor; teste com `sudo reboot` e confira os dois serviços e o heartbeat.

Testado aqui: sintaxe dos scripts e o comando de partida do worker e da web (`node node_modules/tsx/dist/cli.mjs worker/index.ts`, `node node_modules/next/dist/bin/next start`). **Não testado**: os scripts de provisionamento e o `deploy.sh` numa VPS real.

## 4. Dimensionamento inicial

**Premissas (ajuste-as):** 50 sites no início, até 200; checagem de disponibilidade a cada 5 min (padrão do monitor); PageSpeed diário em 3 URLs × 2 dispositivos por site; ~500 eventos/dia por site; retenção de 30 dias de checagens, 90 de eventos, 12 meses de medições.

| Item | 50 sites | 200 sites | Conta |
|---|---|---|---|
| Checagens/dia | 14.400 | 57.600 | sites × 288 |
| Linhas de checagem retidas (30 d) | ~430 mil | ~1,7 milhão | ×30 |
| Chamadas PageSpeed/dia | 300 | 1.200 | sites × 6; a ~45 s com concorrência 2 ≈ 2 h / 7,5 h |
| Eventos retidos (90 d) | ~2,2 milhões | ~9 milhões | sites × 500 × 90 |
| Armazenamento estimado (≈250 B/linha de checagem, ≈300 B/evento, com índices) | ~0,8 GB | ~3,2 GB | estimativa grosseira: **meça** com `pg_database_size` após uma semana |
| `MONITOR_CONCORRENCIA` | 5 | 10 | 200 sites × 288/dia = 40 checagens/min × até 10 s = 400 s de trabalho/min → ≥7 em paralelo |

**VPS inicial:** 2 vCPU, 4 GB de RAM, 40 GB de disco, 2 GB de swap, no Brasil se disponível. A web usa ~300–500 MB, o worker ~150–250 MB; o `next build` é o pico (~2 GB, daí o swap). Login gasta ~125 ms de CPU (scrypt) numa CPU comum e **mais** em VPS fraca: `npm run medir -- --so-scrypt` na VPS mostra o valor real. 200 sites cabem na mesma máquina com `MONITOR_CONCORRENCIA=10`; acima disso, segunda instância de worker (`WORKER_ID` diferente).

**Banco:** 50 sites já pedem gigabytes por causa dos eventos; o plano gratuito de qualquer provedor dificilmente comporta, e pode pausar por inatividade **[depende do plano do Supabase]**. Reduzir o volume pela retenção é decisão de produto (hoje fixa no worker).

## 5. Medição da lentidão

A central abre uma transação por consulta (begin + set_config + consulta + commit = **4 idas e voltas**). Com o banco a 100 ms de distância, cada consulta custa ~400 ms e uma página com 6 consultas passa de 2 s só em rede, mesmo sem CPU. Por isso a primeira medição é a distância.

1. **Antes de implantar** (qualquer máquina com `DATABASE_URL_*` do Supabase): `npm run db:supabase-preflight` imprime a latência de ida e volta e o custo de uma transação da central. Regra prática: acima de ~30 ms por ida e volta, aproxime a VPS da região do banco.
2. **No ar:** `MEDIR_BASE_URL=https://… MEDIR_EMAIL=… MEDIR_SENHA=… npm run medir -- --repeticoes 5` (de qualquer lugar, com navegador): tempos de **login**, **listagem** e **cada aba** (TTFB, DOM, carregada, p50/p95) e a "base" (TTFB de `/entrar`, sem banco) para separar rede de servidor. Rode também **de dentro da VPS** para excluir a rede do operador.
3. **Dentro do servidor:** `DB_LOG_LENTO_MS=0` no `web.env`, `systemctl restart johnyweb-web`, repita a medição e leia `journalctl -u johnyweb-web | grep db-lento`: duração de cada transação, tempo esperando conexão do pool e **número de consultas**. Muitas consultas × latência alta = banco/distância; poucas consultas e duração alta = consulta pesada; tempo grande de "conexão do pool" = `DB_POOL_MAX` pequeno.
4. **CPU do login:** `npm run medir -- --so-scrypt` na VPS.
5. Registre os números em `docs/VALIDACAO-PILOTO.md` (linha "Tempos") para comparar antes/depois de qualquer ajuste. Medido no ambiente de desenvolvimento, só para validar a ferramenta: login ≈ 1,3 s (≈ 125 ms de scrypt), listagem TTFB ≈ 80 ms, latência de banco ≈ 1 ms — **sem valor de referência para produção**.

## 6. Endereço provisório e troca do domínio

**Provisório.** Duas opções **[depende do DNS]**: (a) criar **um registro novo** `piloto.johnyweb.com` apontando para a VPS (não afeta `app.johnyweb.com`); ou (b) sem DNS nenhum, `IP-COM-HIFENS.sslip.io` (resolve para o IP) — serve para começar, mas o certificado depende dos limites públicos desse domínio. Em ambos: nginx com o `server_name` provisório, `certbot --nginx -d <host>`, `APP_URL=https://<host>` em `web.env` e `worker.env`.

**Preservar o antigo.** Nenhuma etapa altera a V1 nem o banco dela; `app.johnyweb.com` continua apontando para ela até a virada.

**Virada (após o piloto aprovado):**
1. 48 h antes: baixe o TTL do registro de `app.johnyweb.com` para 300 s. Anote o destino atual (IP/CNAME, A e AAAA).
2. Emita o certificado de `app.johnyweb.com` **antes** da troca por DNS-01 (`certbot certonly --manual --preferred-challenges dns`) para não haver janela sem HTTPS.
3. Acrescente `app.johnyweb.com` ao `server_name` dos dois blocos do nginx; recarregue.
4. Troque `APP_URL=https://app.johnyweb.com` em `web.env` e `worker.env`; reinicie web e worker. (A checagem de origem aceita o host da requisição e o de `APP_URL`, então o provisório continua funcionando durante a transição.)
5. Mude o registro A (e AAAA, se houver) para a VPS. Confira `/entrar`, login, `Configurações` (worker ativo) e `/c.v1.js` em `app.johnyweb.com`.
6. **Mantenha o host provisório servindo** por ~30 dias: o snippet instalado no site piloto aponta para ele. Depois, troque o snippet pelo da aba Instalação (agora com `app.johnyweb.com`) e desative o provisório.
7. **Retorno:** devolva o registro ao destino anotado (TTL 300 s). **Cuidado com HSTS**: a central envia HSTS de 2 anos para o host em que está; navegadores que visitaram `app.johnyweb.com` na V2 recusarão HTTP nesse host. Se a V1 não servir HTTPS válido ali, o retorno quebra para esses navegadores — confirme isso antes da virada.

## 7. Banco novo e rotina de backup
Projeto Supabase novo e vazio: `deploy.sh <sha> --migrar` roda `db:backup` (vazio, mas valida a cadeia), preflight, migrações e `endurecer`; depois `db:bootstrap` (administrador da central). Backup diário externo (`db:backup` agendado por `cron`/timer na VPS, destino fora dela) é obrigatório mesmo que o plano do Supabase tenha backup próprio.

## 8. Histórico e leads da V1: decisão pendente
O que existe hoje (`docs/IMPORTAR-V1.md`) importa **só cadastro** (clientes, sites, até 3 URLs prioritárias) a partir de um JSON exportado por você; a V1 nunca é acessada. **Não** importa eventos, leads nem medições, porque os modelos diferem (sessão, janela, Lighthouse) e emendar séries inventaria continuidade. Se decidir importar leads/histórico, é uma funcionalidade nova com mapeamento, deduplicação e consentimento/retenção a definir (leads são dados pessoais); fica **fora desta etapa** e deve vir depois do piloto. Até lá, o banco antigo permanece intacto e somente leitura para consulta.

## 9. Informações que ainda faltam
1. Plano e data center da VPS Hostinger (e se há IPv6).
2. Região do projeto Supabase e plano; resultado de `db:supabase-preflight` das três URLs.
3. Para onde `app.johnyweb.com` aponta hoje (A/AAAA/CNAME), quem edita o DNS e se a V1 serve HTTPS válido nesse host (retorno e HSTS).
4. Provisório: `piloto.johnyweb.com` (registro novo) ou sslip.io.
5. Os itens de infraestrutura já listados em `docs/ROTEIRO-PILOTO.md` §8 (e-mail, PageSpeed, site piloto, backup externo, monitor externo).
