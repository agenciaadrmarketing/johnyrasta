# Implantação — web, worker e banco em produção

Guia para colocar a central no ar com um site piloto e depois a carteira. Complementa `docs/OPERACAO.md` (comandos do dia a dia) e `docs/BACKUP.md` (cópias e restauração). Nada aqui foi executado contra uma hospedagem real; o que está marcado como *exemplo* depende do provedor escolhido.

## Topologia

```
                        ┌──────────────────────────┐
  navegador do          │  WEB  (next start)       │  DATABASE_URL          → app_web   (RLS por conta)
  operador  ──────────► │  telas, Server Actions,  │  DATABASE_URL_INGEST   → app_ingest (só /api/collect)
  sites dos clientes ─► │  /api/collect, /api/forms│  DATABASE_URL_FORMS    → app_forms  (só /api/forms)
  (coletor, formulários)│  /c.v1.js, /teste/<id>   │
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  POSTGRESQL 14+ (16)     │  schemas public + app · RLS forçada
                        └────────────▲─────────────┘
                                     │
                        ┌────────────┴─────────────┐
  internet (sites       │  WORKER (npm run worker) │  DATABASE_URL_WORKER   → app_worker
  monitorados, API  ◄── │  fila de monitores,      │  sem acesso a usuários, sessões, contatos
  do PageSpeed)         │  PageSpeed, retenção,    │
                        │  heartbeat               │
                        └──────────────────────────┘
  scripts (db:setup, db:migrate, db:bootstrap, db:backup, db:restaurar)  → DATABASE_URL_ADMIN, só em máquina de operação
```

Três processos, cinco papéis de banco. A web nunca verifica site nenhum; o worker nunca atende requisição. Se o worker parar, a central mostra "sem sinal" em Configurações e "verificação atrasada" nos sites — por isso ele precisa de supervisão, não de boa vontade.

## Requisitos

- **Processo contínuo para o worker**: VPS, container ou "background worker" de plataforma. Hospedagem só de arquivos estáticos ou funções que dormem não serve: a fila é drenada a cada 5 s por um laço que precisa estar vivo. Um ambiente que mata processos ociosos vai gerar "verificação atrasada" o tempo todo.
- **Web**: Node.js 20+ (desenvolvido com 22) rodando `next start`, ou plataforma Next. Em ambiente *serverless* (`VERCEL` ou `AWS_LAMBDA_FUNCTION_NAME` definidos) o pool por papel cai para 3 conexões; dimensione o `max_connections` do banco por instância × papéis.
- **PostgreSQL 14+** (desenvolvido e testado com 16), gerenciado ou próprio, com TLS para conexões remotas. O código exige TLS fora de `localhost`/`127.0.0.1`/`::1`/`host.docker.internal`; com `DATABASE_SSL_CA` a cadeia é verificada, sem ela a conexão é cifrada mas não autenticada.
- **Egress** do worker para a internet (portas 80/443) e para `www.googleapis.com` (PageSpeed); da web para o provedor de e-mail quando houver. O `fetch` do Node não lê `HTTP(S)_PROXY`: um ambiente que só sai por proxy obrigatório precisa de liberação direta desses destinos.
- **Domínio público** da central com HTTPS. Ele vira `APP_URL`, entra em todos os snippets dos sites dos clientes e na checagem de origem das mutações.
- Cliente `pg_dump`/`pg_restore` ≥ versão do servidor na máquina de operação (backups).

## Variáveis por serviço

Nomes conforme `.env.example`; valores só no gestor de segredos. Papel de banco entre parênteses.

| Variável | Web | Worker | Scripts | Observação |
|---|---|---|---|---|
| `DATABASE_URL` (app_web) | obrigatória | — | — | a central; RLS por `app.account_id` |
| `DATABASE_URL_INGEST` (app_ingest) | obrigatória | — | — | `/api/collect` e `/teste/<publicId>` |
| `DATABASE_URL_FORMS` (app_forms) | obrigatória | — | — | `/api/forms/<publicId>` e `/confirmar` |
| `DATABASE_URL_WORKER` (app_worker) | — | obrigatória | — | |
| `DATABASE_URL_ADMIN` (dono/admin) | — | — | obrigatória | `db:setup`, `db:migrate`, `db:bootstrap`, `db:demo`, `db:backup`, `db:restaurar`. Nunca na web nem no worker |
| `DATABASE_SSL_CA` | opcional | opcional | — | conteúdo do certificado raiz do provedor; ativa verificação da cadeia |
| `SESSION_SECRET` | obrigatória (≥ 32 caracteres) | — | — | `openssl rand -base64 48` |
| `APP_URL` | obrigatória | — | — | `https://central.suaagencia.com.br`, sem barra final |
| `NODE_ENV=production` | obrigatória | recomendada | — | liga CSP, HSTS, cookie `Secure`; proíbe `db:setup -- --drop` e `db:demo` sem `DEMO_MODE=1` |
| `PAGESPEED_API_KEY` | opcional | opcional | — | sem ela: "não configurado" na tela e nenhuma medição no worker. Defina nos dois ou em nenhum |
| `PAGESPEED_CONCORRENCIA` | — | opcional (padrão 2) | — | ver dimensionamento |
| `WORKER_ID` | — | opcional (padrão `hostname-pid`) | — | aparece em Configurações |
| `MONITOR_CONCORRENCIA` | — | opcional (padrão 5) | — | ver dimensionamento |
| `MONITOR_EXCECOES_DE_REDE` | — | **vazia em produção** | — | IPs privados liberados; o worker avisa no log se houver |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | opcional | opcional | — | Configurações mostra "configurado" quando `EMAIL_PROVIDER` existe; o envio em si depende do adaptador da frente de notificações |
| `CSP_RELATORIO=1` | opcional | — | — | troca a CSP por `Content-Security-Policy-Report-Only` (diagnóstico) |
| `DEMO_MODE` | nunca em produção | — | nunca em produção | ver checklist |
| `BACKUP_DIR`, `PG_BIN` | — | — | opcionais | destino dos dumps; diretório dos binários do PostgreSQL |
| `BOOTSTRAP_ACCOUNT/NAME/EMAIL/PASSWORD`, `BOOTSTRAP_FORCE` | — | — | só no `db:bootstrap` | apague do ambiente depois |

Cada papel tem senha própria. As senhas vão **dentro das URLs** (`postgres://app_web:SENHA@host:5432/johnyweb?sslmode=require`); `db:setup` cria ou atualiza os papéis a partir delas. Trocar uma senha = trocar a URL e rodar `db:setup` de novo (não apaga nada sem `--drop`).

## Passo a passo

### 1. Banco
1. Crie a instância (PostgreSQL 16 recomendado) com TLS e backups automáticos do provedor ligados.
2. Obtenha a URL administrativa (dono do banco; superusuário não é necessário, mas o papel precisa de `CREATEROLE` para `db:setup` criar os quatro papéis, ou crie-os você mesmo com `LOGIN PASSWORD`).
3. Gere quatro senhas distintas e monte as URLs de `app_web`, `app_worker`, `app_ingest`, `app_forms` com o mesmo host e `?sslmode=require`.

### 2. Schema e papéis (máquina de operação, com as URLs no ambiente)
```bash
npm ci
npm run db:setup       # cria o database se faltar, cria/atualiza os papéis com as senhas das URLs, aplica migrations/
```
`db:setup` é idempotente. Em atualizações posteriores, `npm run db:backup && npm run db:migrate`.

### 3. Proprietário
```bash
BOOTSTRAP_ACCOUNT="Nome da agência" BOOTSTRAP_NAME="Seu nome" BOOTSTRAP_EMAIL="voce@agencia.com.br" BOOTSTRAP_PASSWORD="…" npm run db:bootstrap
```
Recusa rodar se já existir usuário. Não há senha padrão em lugar nenhum; **não rode `db:demo` em produção**.

### 4. Web
- Build: `npm ci && npm run build`. Execução: `npm start` (porta `PORT`, padrão 3000) atrás do proxy reverso com HTTPS, ou a plataforma Next da hospedagem.
- O proxy reverso precisa repassar `X-Forwarded-For` (limites por IP) e `Host`/`Origin` sem reescrever (checagem de origem das mutações compara com `APP_URL`).
- Em produção o `proxy.ts` aplica CSP com nonce, HSTS (`max-age` de 2 anos, `includeSubDomains` — confirme que **todos** os subdomínios do domínio da central servem HTTPS antes de publicar), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Confira `APP_URL/entrar` no navegador e entre com o proprietário. Em Configurações: "Banco de dados: conectado como app_web", "Worker: nunca visto" (normal até o passo 5).

### 5. Worker supervisionado
`npm run worker` executa `tsx worker/index.ts`. Precisa de restart automático e de parada por `SIGTERM` (o laço termina a rodada atual e encerra o pool).

*Exemplo* de unidade systemd (ajuste usuário, caminho e arquivo de ambiente):
```ini
[Unit]
Description=JohnyWeb worker
After=network-online.target

[Service]
User=johnyweb
WorkingDirectory=/srv/johnyweb
EnvironmentFile=/etc/johnyweb/worker.env      # DATABASE_URL_WORKER, WORKER_ID, PAGESPEED_API_KEY…
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```
Em plataformas com "background worker"/"worker service", o comando é o mesmo. Confirme em Configurações: "Worker: ativo · visto há poucos segundos" com o `WORKER_ID` esperado. Cinco minutos sem heartbeat viram "sem sinal".

Pode haver mais de uma instância (a fila usa lease; `SKIP LOCKED`). Dê um `WORKER_ID` diferente a cada uma.

### 6. Monitor externo da própria central
Se web e worker caírem juntos, ninguém avisa. Cadastre `APP_URL/entrar` num monitor externo (UptimeRobot, Better Stack, Healthchecks ou o do provedor) com alerta para o operador. Opcional: um segundo monitor na página pública `APP_URL/teste/<publicId de um site>` cobre também o papel `app_ingest`.

### 7. Backup
Agende `npm run db:backup` diário na máquina de operação, envie para armazenamento externo e faça a primeira restauração de teste **antes** de cadastrar a carteira (`docs/BACKUP.md`).

### 8. Piloto e carteira
Um site primeiro: aba Instalação → coletor → teste com token → visita, clique e formulário confirmados → um contato real. Só então o restante (`docs/INSTALACAO-NO-SITE.md`).

## Rollback

- **Aplicação**: migrações são aditivas (nunca removem coluna ou tabela em uso pela versão anterior). Voltar a versão da web e do worker não exige mexer no banco. Volte os dois juntos: um worker novo com web velha (ou vice-versa) funciona, mas pode gravar estados que a tela velha não sabe mostrar.
- **Migração que falhou**: cada arquivo roda numa transação; falha = nada aplicado, `schema_migrations` sem a versão. Corrija e rode `db:migrate` de novo.
- **Banco corrompido ou dado apagado por engano**: restaure o último backup **num banco novo** e troque as URLs (procedimento em `docs/BACKUP.md`, "Promover um banco restaurado"). Nunca por cima do banco em uso.
- **Papéis**: `db:setup` recria concessões? Não — concessões e políticas vêm das migrações já aplicadas. Se um papel for apagado por engano no cluster, recrie-o com o mesmo nome e rode as concessões das migrações correspondentes à mão, ou restaure um backup num banco novo (o dump carrega as concessões).

## Bloqueio de egress no ambiente do worker (segunda camada anti-SSRF)

O verificador já recusa, em código, destinos privados, link-local/metadata, CGNAT, multicast e portas fora de 80/443 (`src/modules/monitoring/rede.ts`, D16/D17), antes de resolver, depois de resolver todos os endereços e a cada redirecionamento. A segunda camada é a rede: mesmo que um bug passe, o pacote não sai.

Na máquina ou container do worker, bloqueie saída para:

| Faixa | O que é |
|---|---|
| `127.0.0.0/8`, `::1/128` | loopback (exceto o próprio banco se for local — nesse caso libere só a porta dele) |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | redes privadas |
| `169.254.0.0/16`, `fe80::/10` | link-local e **metadata de nuvem** (`169.254.169.254`) |
| `100.64.0.0/10` | CGNAT |
| `fc00::/7` | ULA IPv6 |
| `0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4`, `ff00::/8` | reservadas e multicast |

*Exemplo* com nftables (Linux; adapte ao gerenciador de firewall do host — em nuvem, use security group/firewall de saída com as mesmas faixas):
```
table inet johnyweb_worker {
  chain output {
    type filter hook output priority 0; policy accept;
    skuid johnyweb ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 } counter drop
    skuid johnyweb ip6 daddr { ::1/128, fc00::/7, fe80::/10, ff00::/8 } counter drop
  }
}
```
Se o banco estiver numa rede privada, abra uma exceção **só** para `host:porta` do banco, antes da regra de descarte. Em Kubernetes, uma `NetworkPolicy` de egress com `ipBlock.except` cumpre o mesmo papel. Deixe `MONITOR_EXCECOES_DE_REDE` vazia: ela existe para teste local e rede própria, e o worker avisa no log quando há algo nela.

## Dimensionamento

### `MONITOR_CONCORRENCIA` (padrão 5)
- Carga: checagens por minuto = Σ (60 / intervalo em segundos) dos monitores ativos. 100 sites a cada 5 min = 20/min.
- Pior caso por checagem: `timeout_ms` do monitor (padrão 10 s, máximo 30 s) + até 3 redirecionamentos dentro do mesmo prazo. Trabalho por minuto no pior caso = 20 × 10 s = 200 s; concorrência mínima = 200 / 60 ≈ 3,4 → 5 cobre com folga. Para 300 sites a 5 min, use 10–15 ou uma segunda instância.
- Cada rodada reivindica até 20 monitores e o laço dorme 5 s; o pool do worker tem `concorrência + 2` conexões — some isso ao `max_connections` do banco.
- Sinal de pouca capacidade: em Configurações, "Fila de verificações: N atrasados" por mais de um ciclo; no log, `rodada: … descartadas (lease perdido)` recorrente indica checagens que passam de 90 s (lease) — suba a concorrência antes de mexer no lease.

### `PAGESPEED_CONCORRENCIA` (padrão 2)
- Cada medição leva 30–60 s e consome 1 chamada da cota da chave. Agenda: uma medição por URL × dispositivo por dia (UTC). 100 sites × 3 URLs × 2 dispositivos = 600 chamadas/dia; a 45 s cada, concorrência 2 drena em ~3,75 h — aceitável para um ciclo diário.
- Suba só se a cota da chave no console do Google permitir: concorrência maior com cota menor só produz 429 e retentativas (2, 4, 8 min… até 4 tentativas, depois `erro`).
- Sinal: "Fila parada" (devidas há mais de 2 h sem nenhuma concluída) em Configurações e um alerta por dia em Atenção. Antes de mexer na concorrência, confira a cota e o log do worker.

## Limites conhecidos

- **Limites de requisição em memória, por instância**: 240/min por IP e 120/min por site+IP na coleta; 30/min por site+IP em formulários; 60/min na confirmação por webhook. Com N instâncias da web o teto efetivo é N×. O IP vem do primeiro valor de `X-Forwarded-For`: o proxy reverso precisa sobrescrevê-lo, ou o limite é contornável por cabeçalho.
- **Rate limit zera a cada reinício** e não é compartilhado — é proteção contra abuso simples, não contra ataque distribuído. Para isso, use o WAF/limite da borda.
- **CSP** só em produção (`next dev` usa `eval`). `style-src 'unsafe-inline'` é consequência da arquitetura visual; `script-src` com nonce e `'strict-dynamic'`; `connect-src 'self'` — a central não chama API de terceiros a partir do navegador. `/api/*` e `/c.v1.js` ficam fora da CSP de propósito (consumidos por outras origens). Para diagnosticar, `CSP_RELATORIO=1` publica em modo só-relatório.
- **HSTS com `includeSubDomains`** por dois anos: publique a central num domínio cujos subdomínios todos tenham HTTPS, ou num subdomínio dedicado.
- **E-mail**: hoje a central só distingue "configurado"/"não configurado" por `EMAIL_PROVIDER`; alertas vivem na tela de Atenção. O envio depende do adaptador da frente de notificações e de um provedor; a saída HTTPS do processo que envia precisa estar liberada (sem proxy obrigatório, ver Requisitos).
- **PageSpeed sem chave** não mede nada e a tela diz isso; nunca há nota inventada.
- **Sessões**: cookie `Secure` só com `NODE_ENV=production`; 14 dias; revogação imediata no banco. Não há recuperação de senha por e-mail: a troca é feita por quem está logado, e um proprietário sem acesso precisa de outro proprietário ou de `BOOTSTRAP_FORCE=1 npm run db:bootstrap` na máquina de operação.
- **Uma região, um banco**: não há réplica de leitura nem failover automático no código; isso é do provedor.
