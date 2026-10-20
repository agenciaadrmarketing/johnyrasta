# Rodar e testar a V2 no notebook e no celular

Caminho de desenvolvimento **sem servidor contratado**: a central e o worker rodam no seu notebook; você abre pelo navegador do notebook e pelo celular na mesma rede Wi-Fi. O banco é o **PostgreSQL local de desenvolvimento** até o Supabase ser validado (seção 5). Nada aqui publica, altera DNS nem toca na V1.

> Nesse modo, **tudo para quando o notebook dorme, desliga ou você fecha os terminais**: checagens de disponibilidade, PageSpeed, e-mails e heartbeat só acontecem enquanto `npm run worker` estiver rodando. Ao voltar, a central mostra "verificação atrasada"/"worker sem sinal" para o período parado; isso é o comportamento correto, não um defeito.

## 1. Pré-requisitos (uma vez)
- Node.js 20 ou mais novo (testado com 22) e Git.
- PostgreSQL 14+ local (testado com 16) em `localhost:5432`, com um usuário administrador.
- Notebook e celular no **mesmo Wi-Fi**, de preferência rede de casa (a porta 3000 fica aberta para a rede local enquanto a central roda).

```bash
git clone <repositório> johnyweb && cd johnyweb
git checkout claude/new-session-ij77ds
npm install
cp .env.example .env.local          # ajuste as senhas das URLs do banco local; o resto pode ficar como está
npm run db:setup                    # cria banco, papéis e aplica as migrações
npm run db:bootstrap                # cria o seu usuário (pede nome, e-mail e senha)
```
Opcional, dados de demonstração para ver as telas cheias: `npm run db:demo` (conta separada, identificada como demonstração).

## 2. Iniciar

**Terminal 1 — central (versão de produção, acessível na rede):**
```bash
npm run lan
```
Faz o build (1–2 min na primeira vez) e sobe `next start` escutando na rede. Ele imprime os endereços:
```
  Notebook:  http://localhost:3000
  Celular:   http://192.168.0.15:3000   (wlan0 — usado como APP_URL)
```
Para pular o build quando nada mudou: `npm run lan -- --sem-build`. Com VPN, Docker ou várias placas de rede, escolha o IP: `npm run lan -- --ip 192.168.0.15`. Para editar código com recarga automática (mais lento; não serve para medir tempos): `npm run lan:dev`.

**Terminal 2 — worker:**
```bash
npm run worker
```
Ele registra no console o que está e o que não está configurado (PageSpeed, e-mail). Em Configurações, "Worker: ativo · visto há poucos segundos".

## 3. Acessar
- **Notebook:** `http://localhost:3000` → entre com o usuário do bootstrap.
- **Celular:** o endereço `Celular:` impresso pelo `npm run lan` (algo como `http://192.168.0.15:3000`). Digite-o no navegador do celular; se não abrir: (a) confirme que os dois estão no mesmo Wi-Fi (redes de visitante isolam aparelhos); (b) libere a porta 3000 no firewall do notebook (Windows pergunta na primeira vez: permita em "rede privada"); (c) se houver mais de um IP listado, tente o outro.
- Como descobrir o IP sem o script: Windows `ipconfig` (Endereço IPv4 do adaptador Wi-Fi); macOS/Linux `ip -4 addr` ou `ifconfig`.

**Login, cookies e `APP_URL` nesse acesso.** O `npm run lan` define `APP_URL=http://<IP>:3000` **só para aquele processo** (o `.env.local` não muda). Esse endereço `http://` em rede privada é a **única** condição em que a versão de produção aceita o cookie de sessão sem `Secure`, não envia HSTS e não força `upgrade-insecure-requests`; sem isso o celular não conseguiria manter o login por HTTP. A regra está em `src/shared/ambiente.ts`, com teste: qualquer `APP_URL` com `https://`, com host público ou ausente mantém **todas** as proteções de produção. Testado aqui: login pelo navegador em `http://127.0.0.1:3000` grava cookie `httpOnly`, `SameSite=Lax`, sem `Secure`, e a sessão sobrevive ao recarregar; com `APP_URL=https://…`, os cabeçalhos HSTS e `upgrade-insecure-requests` voltam.

Links de e-mail e de recuperação de senha usam esse `APP_URL`, então só abrem no celular dentro da mesma rede.

## 4. Encerrar
`Ctrl+C` em cada terminal (a central sai na hora; o worker termina a rodada em andamento, até ~90 s se houver uma chamada lenta ao PageSpeed). Fechou os terminais ou desligou o notebook: nada roda.

## 5. Supabase (projeto novo) — compatibilidade e ligação

**Estado: não verificado contra o projeto real.** As credenciais não foram fornecidas a este ambiente; o que existe é a ferramenta e o procedimento. O banco usado nos testes de interface continua sendo o **local**; ele **não é** o Supabase.

### 5.1 Arquivo separado, sem tocar no `.env.local`
Crie `.env.supabase` (já ignorado pelo Git) com as URLs do projeto — valores só no seu notebook:
```
DATABASE_URL_ADMIN=postgres://postgres.<ref>:SENHA@<host do pooler>:5432/postgres?sslmode=require
DATABASE_URL=postgres://app_web.<ref>:SENHA@<host do pooler>:6543/postgres?sslmode=require
DATABASE_URL_WORKER=postgres://app_worker.<ref>:SENHA@<host do pooler>:5432/postgres?sslmode=require
DATABASE_URL_INGEST=postgres://app_ingest.<ref>:SENHA@<host do pooler>:6543/postgres?sslmode=require
DATABASE_URL_FORMS=postgres://app_forms.<ref>:SENHA@<host do pooler>:6543/postgres?sslmode=require
DB_ROLE_SUFFIX=<ref>
DATABASE_SSL_CA_FILE=./supabase-ca.crt     # certificado baixado no painel (Database → SSL)
```
`<ref>` é o identificador do projeto (o começo do endereço `https://<ref>.supabase.co`); host e portas do pooler vêm do painel, em Connect. As senhas de `app_*` são as que você escolher: `db:setup` cria os papéis com elas.

### 5.2 Somente leitura primeiro
```bash
ENV_FILE=.env.supabase npm run db:supabase-preflight                 # administrador
ENV_FILE=.env.supabase npx tsx scripts/supabase.ts preflight DATABASE_URL          # depois de criar os papéis
```
O preflight **não cria nem altera nada**: lista versão, TLS, DNS (IPv4/IPv6), permissões do administrador (`CREATEROLE`, `BYPASSRLS`), papéis da API do Supabase, concessões já existentes e a latência de uma transação da central. Cole a saída aqui (ela não contém senha).

### 5.3 Se o administrador não tiver `BYPASSRLS`
**O que depende do privilégio hoje.** Todas as tabelas têm RLS **forçada** (`force row level security`), que se aplica até ao dono. Dependem de o dono enxergar as linhas:
1. as funções `SECURITY DEFINER` de login, sessão e recuperação de senha (`app.find_user_for_login`, `app.create_session`, `app.find_user_for_session`, `app.revoke_*`, `app.list_sessions`, `app.password_hash_of`, `app.update_*`, `app.request_password_reset`, `app.password_reset_valid`, `app.consume_password_reset`): rodam como o dono; sem o privilégio, **o login devolve zero linhas**;
2. `db:bootstrap`, `db:demo`, `db:importar-v1` (gravam com a URL administrativa);
3. `db:backup` (`pg_dump` falha com "query would be affected by row-level security policy"), `db:restaurar` e a contagem de `verificar-restauracao`.

**Adaptação de menor privilégio (já implementada e testada em emulação).** `npm run db:migrate` detecta que o administrador não ignora a RLS e cria, em cada tabela com RLS, uma política explícita `admin_<tabela> … TO <administrador> USING (true) WITH CHECK (true)` (`scripts/rls-admin.ts`). Uma política é restrita ao papel nomeado: `app_web`, `app_worker`, `app_ingest` e `app_forms` continuam presos às políticas por conta (`tests/integration/rls-admin.spec.ts` prova que, com as políticas, o login volta a funcionar e `app_web` continua sem ver contas fora do contexto). Nada é desligado, a RLS continua forçada, e a credencial administrativa continua **só nos scripts** — nunca na web nem no worker. O `pg_dump` passa a rodar com `--enable-row-security`, e o backup se recusa a rodar enquanto as políticas não existirem (antes, sairia vazio ou falharia). Quando o administrador **tem** `BYPASSRLS`, nenhuma política é criada.

**Sem `CREATEROLE`:** crie os quatro papéis pelo SQL Editor (`create role app_web login password '…'`, etc.) e rode `db:migrate` em vez de `db:setup`; a migração 0005 também cria dois papéis `nologin` se faltarem, o que exige `CREATEROLE` — nesse caso crie-os antes.

Migrar para uma VPS **não muda** nada disto: as permissões são do projeto Supabase, não do lugar onde a aplicação roda.

### 5.4 Ligar (só depois do preflight e da sua aprovação)
```bash
ENV_FILE=.env.supabase npm run db:setup              # ou db:migrate, conforme 5.3
ENV_FILE=.env.supabase npm run db:supabase-endurecer # revoga de anon/authenticated o acesso a public (altera permissões: só com aprovação)
ENV_FILE=.env.supabase npm run db:bootstrap
```
Para a central e o worker usarem o Supabase, aponte as cinco `DATABASE_URL*`, `DB_ROLE_SUFFIX` e `DATABASE_SSL_CA_FILE` no ambiente desses processos (por exemplo, `.env.local` próprio ou exportando as variáveis antes de `npm run lan` / `npm run worker`). Não há migração de dados do banco local: ele é descartável.

## 6. Medir tempos
Com a central rodando (`npm run lan`), em outro terminal:
```bash
MEDIR_BASE_URL=http://localhost:3000 MEDIR_EMAIL=<seu e-mail> MEDIR_SENHA=<sua senha> npm run medir -- --repeticoes 5 --fx
```
Mostra: CPU de login (scrypt), TTFB/DOM/carregada por tela (p50/p95), uma base sem banco e, com `--fx`, a CPU da aba com os efeitos Matrix ligados e desligados. Para ver as consultas por transação, inicie a central com `DB_LOG_LENTO_MS=0 npm run lan -- --sem-build` e leia as linhas `[db-lento]`. Resultados medidos neste ambiente estão em `docs/PROGRESSO.md` (Fase 6.2).
