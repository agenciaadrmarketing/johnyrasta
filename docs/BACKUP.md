# Backup e restauração do banco

O banco é a única coisa que não se refaz com um `git clone`: contas, sites, histórico de checagens, medições, eventos e contatos moram só lá. Este documento diz o que copiar, com que frequência, como restaurar e como provar que a restauração funciona — com uma restauração real registrada no fim.

Ferramentas: `npm run db:backup` (`scripts/backup.ts`), `npm run db:restaurar` (`scripts/restaurar.ts`) e `npx tsx scripts/verificar-restauracao.ts`. Todas usam `DATABASE_URL_ADMIN` e as ferramentas de linha de comando do PostgreSQL (`pg_dump`, `pg_restore`) na versão do servidor ou mais nova.

## O que o arquivo contém — e o que não contém

`pg_dump` em formato custom (`-Fc`, comprimido). Um arquivo por execução, ponto no tempo.

| Vai no `.dump` | NÃO vai (e precisa de outro cuidado) |
|---|---|
| Schemas `public` e `app` | **Segredos de ambiente**: `SESSION_SECRET`, `PAGESPEED_API_KEY`, credenciais de e-mail — ficam no gestor de segredos da hospedagem |
| Todas as tabelas e seus dados (contas, usuários com hash de senha, sessões, sites, monitores, checagens, incidentes, alertas, medições, eventos, contatos, submissões, auditoria, `schema_migrations`) | **Senhas dos papéis** `app_web`, `app_worker`, `app_ingest`, `app_forms`: são atributos do cluster, não do banco. Quem as define é `npm run db:setup` a partir das URLs |
| Funções `app.*` (login, sessão, `current_account_id`) | **Os próprios papéis**: o dump referencia `app_web` etc. nas políticas e concessões, mas não os cria. `db:restaurar` cria os que faltarem, sem login |
| Políticas RLS, `ENABLE`/`FORCE ROW LEVEL SECURITY`, concessões (`GRANT`) aos papéis, índices, restrições, sequências | Configurações do servidor (`postgresql.conf`), extensões fora do padrão (não usamos nenhuma além de `plpgsql`), arquivos em disco (não há uploads) |

O dump contém **dados pessoais** (e-mails e telefones de contatos, e-mails de usuários, hashes de senha). Trate o arquivo com o mesmo cuidado do banco: acesso restrito, armazenamento cifrado, exclusão no fim da retenção.

## Política

- **Frequência**: diária, de madrugada no fuso da operação, e **antes de cada migração** (`npm run db:migrate` em produção começa com um `npm run db:backup`). Migrações são aditivas, mas um backup imediatamente anterior é o que torna o rollback de dados possível se uma migração for aplicada no banco errado.
- **Retenção**: 30 dias de diários. Guarde também o último backup anterior a cada migração enquanto a versão correspondente da aplicação ainda puder ser reativada. Checagens detalhadas já expiram em 30 dias no próprio banco; eventos em 90; medições em 12 meses (retenção do worker) — o backup não precisa ser mais longo que o dado que protege, salvo exigência contratual do cliente.
- **Onde guardar**: fora da máquina do banco e fora da máquina da aplicação. Mínimo: um bucket de objeto com versionamento e acesso só para a conta de backup. Se o provedor do banco gerenciado oferece snapshot automático, mantenha-o ligado — é uma camada a mais, não substitui o dump que você sabe restaurar.
- **Acesso**: a URL administrativa é só dos scripts. O processo de backup roda numa máquina de operação (ou job agendado), nunca dentro do processo web.
- **Teste de restauração**: mensal, documentado abaixo. Backup não testado é hipótese.

## Procedimento de backup

```bash
# no diretório do projeto, com DATABASE_URL_ADMIN no ambiente ou em .env.local
npm run db:backup
# → ./backups/johnyweb-2026-10-20T01-07.dump (carimbo em UTC)

BACKUP_DIR=/var/backups/johnyweb npm run db:backup     # outro diretório (criado se não existir)
PG_BIN=/usr/lib/postgresql/16/bin npm run db:backup    # quando pg_dump não está no PATH
```

O script:
1. confere que `pg_dump` existe e que sua versão maior é ≥ à do servidor (um cliente mais velho que o servidor é recusado com mensagem);
2. grava `johnyweb-<AAAA-MM-DDTHH-MM>.dump` (dois backups no mesmo minuto geram `-2`, `-3`… em vez de sobrescrever);
3. imprime banco, versões, caminho e tamanho. A senha vai por `PGPASSWORD`, não por argumento.

Agendamento (exemplo com cron numa máquina de operação Linux):

```cron
17 3 * * *  cd /srv/johnyweb && BACKUP_DIR=/var/backups/johnyweb npm run db:backup >> /var/log/johnyweb-backup.log 2>&1
45 3 * * *  find /var/backups/johnyweb -name 'johnyweb-*.dump' -mtime +30 -delete
```

Depois do `db:backup`, envie o arquivo para o armazenamento externo (`aws s3 cp`, `rclone copy`, o que a hospedagem oferecer). Um backup que só existe no mesmo disco do banco não é backup.

## Procedimento de restauração

A restauração **sempre vai para um banco separado**. O script recusa `--para` igual ao banco de `DATABASE_URL_ADMIN` e aos bancos de sistema. Promover o banco restaurado é uma decisão explícita do operador (trocar as URLs), nunca um efeito colateral.

```bash
npm run db:restaurar -- --para johnyweb_restaurado                       # usa o .dump mais recente de BACKUP_DIR
npm run db:restaurar -- --para johnyweb_restaurado --arquivo backups/johnyweb-2026-10-20T01-07.dump
npm run db:restaurar -- --para johnyweb_restaurado --forcar              # apaga e recria um alvo que já tenha conteúdo
npm run db:restaurar -- --para johnyweb_restaurado --sem-verificacao     # só restaura (não recomendado)
```

O que acontece, em ordem:
1. valida o arquivo com `pg_restore --list` e mostra de onde ele veio (banco, versão do servidor, versão do `pg_dump`);
2. garante os papéis `app_web`, `app_worker`, `app_ingest`, `app_forms` no cluster — cria **sem login** os que faltarem (num cluster novo, rode `npm run db:setup` depois para definir as senhas);
3. cria o banco alvo; se ele existir com conteúdo, recusa sem `--forcar`;
4. `pg_restore --no-owner --exit-on-error --single-transaction` — dono dos objetos vira o papel administrador que conecta; **as concessões e políticas são preservadas** (não usamos `--no-privileges`); qualquer erro desfaz tudo e o alvo fica vazio;
5. verifica (abaixo).

Por que `--single-transaction` funciona com RLS forçada: no sumário do arquivo as entradas `TABLE DATA` vêm antes das `ROW SECURITY` e `POLICY`; a carga acontece com a RLS ainda desligada, e as políticas entram no fim. Verificado no dump real (`pg_restore --list`).

### Verificação

`db:restaurar` termina chamando `scripts/verificar-restauracao.ts`, que também roda sozinho:

```bash
npx tsx scripts/verificar-restauracao.ts --alvo johnyweb_restaurado              # origem = banco de DATABASE_URL_ADMIN
npx tsx scripts/verificar-restauracao.ts --alvo johnyweb_restaurado --origem johnyweb
```

Compara origem × alvo:
- contagem de linhas de **cada** tabela (`count(*)`, não estimativa);
- versões em `schema_migrations`;
- políticas RLS — nome, comando, papéis e hash das expressões `using`/`with check`;
- tabelas com RLS ativa e se está forçada;
- concessões aos papéis `app_*` em tabelas, sequências, funções e schemas (lidas de `aclexplode`, independente de quem concedeu);
- funções, número de índices e de restrições.

Saída: **divergência estrutural** (migração, política, concessão, tabela, função) é falha e o processo sai com código 1. **Contagem diferente** é aviso: a origem pode ter recebido gravações depois do backup — compare com a hora do arquivo. Num ambiente parado, contagens iguais são o esperado e é isso que o teste automático exige.

### Promover um banco restaurado (só em caso de corrupção ou perda)

1. Pare o worker e coloque a aplicação em manutenção (ou pare a web).
2. `npm run db:backup` do banco atual, mesmo corrompido: é a evidência.
3. `npm run db:restaurar -- --para johnyweb_YYYYMMDD --arquivo <o último bom>`; leia a verificação.
4. Troque o nome do banco nas cinco URLs (`DATABASE_URL_ADMIN`, `DATABASE_URL`, `DATABASE_URL_WORKER`, `DATABASE_URL_INGEST`, `DATABASE_URL_FORMS`) para `johnyweb_YYYYMMDD`. As senhas dos papéis não mudam: são do cluster.
5. Suba a web, entre, confira Configurações (banco conectado como `app_web`, worker "nunca visto" até reiniciar) e um site qualquer. Suba o worker; ele retoma a fila pelos `next_check_at` restaurados.
6. Comunique a janela perdida: tudo entre o backup e a falha não existe mais. A central não inventa o que faltou — as lacunas aparecem como "sem amostras" na Disponibilidade.

Nunca restaure "por cima" do banco em uso: não há como voltar atrás, e qualquer gravação em andamento se perde silenciosamente.

## Teste de restauração mensal

Uma vez por mês, de preferência no mesmo dia do backup anterior a uma migração:

1. Pegue o backup **mais recente do armazenamento externo** (não o do disco local): é ele que precisa funcionar.
2. `npm run db:restaurar -- --para johnyweb_teste_restauracao --arquivo <arquivo> --forcar`.
3. Leia a verificação: migrações, políticas, concessões e funções têm de ser **iguais**; contagens podem diferir só em tabelas vivas (`auth_sessions`, `audit_log`, `checks`, `events`, `worker_heartbeats`) e só para mais na origem.
4. Prova de RLS no restaurado (30 segundos com `psql -d johnyweb_teste_restauracao` como `app_web`): `select count(*) from sites;` → `0` sem contexto; `begin; select set_config('app.account_id', '<uuid de uma conta>', true); select count(*) from sites; rollback;` → só os sites daquela conta.
5. Registre data, arquivo, duração e resultado numa linha da tabela abaixo. Depois `drop database johnyweb_teste_restauracao;`.

| Data | Arquivo | Ambiente | Resultado |
|---|---|---|---|
| 20/10/2026 | `johnyweb-2026-10-20T01-07.dump` (169,8 KB) | desenvolvimento local, PostgreSQL 16.15 | fiel: 29 tabelas, 566 linhas, 6 migrações, 54 políticas, 139 concessões iguais — detalhes abaixo |

O teste automático `tests/integration/backup.spec.ts` faz o mesmo ciclo a cada execução da suíte de integração (banco de teste semeado → backup → restauração em `<banco de teste>_restaurado` → contagens, políticas e concessões iguais → RLS valendo como `app_web` e `app_ingest` → recusa sobrescrever sem `--forcar` → verificação acusa política e concessão removidas). Ele é pulado, com aviso, se `pg_dump`/`pg_restore` não estiverem no PATH.

## Restauração demonstrada em 20/10/2026

Ambiente: máquina de desenvolvimento, PostgreSQL 16.15 local, banco `johnyweb` com dados reais de desenvolvimento (contas de teste, 42 sites, eventos, contatos e medições de fases anteriores; a migração `0006_notificacoes` de outra frente já estava aplicada nele). Saída real, sem edição além desta nota.

```
$ npm run db:backup

Backup lógico com pg_dump (formato custom, comprimido)
· banco "johnyweb" · servidor PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · pg_dump 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
· arquivo: /home/user/johnyrasta/.claude/worktrees/wf_61ed2e7e-7df-4/backups/johnyweb-2026-10-20T01-07.dump (169,8 KB) em 0,2 s
· contém: schema, dados, funções, políticas RLS e concessões aos papéis app_*
· NÃO contém: SESSION_SECRET, senhas dos papéis, chaves de API — ficam no gestor de segredos
Para testar a restauração: npm run db:restaurar -- --para johnyweb_restaurado --arquivo backups/johnyweb-2026-10-20T01-07.dump
```

```
$ npm run db:restaurar -- --para johnyweb_restaurado_demo

Restauração para "johnyweb_restaurado_demo"
· arquivo: /home/user/johnyrasta/.claude/worktrees/wf_61ed2e7e-7df-4/backups/johnyweb-2026-10-20T01-07.dump · banco de origem no dump: johnyweb · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · pg_dump 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · 346 entradas
· papéis presentes no cluster: app_web, app_worker, app_ingest, app_forms
· alvo "johnyweb_restaurado_demo" criado
· pg_restore --no-owner --exit-on-error --single-transaction --no-password concluído em 0,2 s
Verificação (origem "johnyweb" × alvo "johnyweb_restaurado_demo")
· tabelas: 29 na origem, 29 no alvo
· contagem de linhas igual nas 29 tabelas (566 linhas)
· schema_migrations: 6 versões iguais (0001_fundacao … 0006_notificacoes)
· políticas RLS: 54 na origem, 54 no alvo, mesmos nomes, comandos, papéis e expressões
· tabelas com RLS: 27 na origem, 27 no alvo, mesmas tabelas e mesmo "forçada"
· concessões a app_*: 139 na origem, 139 no alvo, iguais (tabelas, sequências, funções, schemas)
· funções: 11 na origem, 11 no alvo, iguais
· índices: 82 na origem, 82 no alvo · restrições: 131 na origem, 131 no alvo
Resultado: restauração fiel ao backup e igual à origem atual (0,4 s).
Para inspecionar: psql -d johnyweb_restaurado_demo · para descartar: drop database johnyweb_restaurado_demo;
```

Prova adicional, conectando ao banco restaurado com os papéis da aplicação (script descartável, mesmas URLs de `.env.local` apontadas para `johnyweb_restaurado_demo`):

```
· admin no restaurado: 42 sites no total, 1 da primeira conta
· app_web sem contexto de conta: 0 sites (RLS forçada nega tudo)
· app_web com app.account_id da primeira conta: 1 sites (só os dela)
· app_web lendo auth_sessions diretamente: negado (42501)
· app_ingest lendo contacts: negado (42501)
```

Limpeza: `drop database johnyweb_restaurado_demo` executado em seguida; só `johnyweb` e os bancos de teste permaneceram no cluster. Nada falhou nesta demonstração. O que ela **não** prova: restauração entre versões diferentes do PostgreSQL, em banco gerenciado com papel administrador sem superusuário, ou com um arquivo vindo do armazenamento externo — são exatamente os pontos do teste mensal em produção.

## Limites conhecidos

- É backup lógico de ponto no tempo. Não há recuperação contínua (PITR): tudo entre o último dump e uma falha se perde. Se a carteira crescer a ponto de uma hora de eventos importar, ligue o PITR do provedor gerenciado além do dump.
- Restauração em cluster com papel administrador **não superusuário** (bancos gerenciados): `--no-owner` resolve a propriedade, e as políticas entram depois dos dados; mas o papel precisa poder criar banco e criar papéis (`CREATEDB`, `CREATEROLE`) ou os quatro papéis já devem existir. Teste no provedor antes de depender disso.
- O arquivo não é cifrado pelo script. Cifre no armazenamento (bucket com criptografia em repouso e acesso restrito) ou com `age`/`gpg` antes de enviar.
- `pg_dump` mais velho que o servidor é recusado; mais novo funciona. Em servidor 17+, instale o cliente 17+ na máquina de operação.
