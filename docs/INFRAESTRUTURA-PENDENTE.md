# Infraestrutura: requisitos, pendências e ordem de contratação

Estado em 20/10/2026. **Nada está aprovado, contratado ou configurado.** Este documento só registra o que é necessário para a versão atual do código, o que está pendente e o que já ficou pronto no repositório. Não contém preços: custos variam por provedor e plano e precisam ser conferidos por você nos sites deles.

## 1. Confirmado e pendente

**Confirmado (pelo usuário)**
- Hospedagem atual: Hostinger Premium.
- Banco da V2: uma conta **nova** do Supabase, por motivo pessoal.
- Endereço atual: `app.johnyweb.com`. Endereço provisório **proposto**: `piloto.johnyweb.com` (sem DNS configurado).
- A versão atual apresenta lentidão generalizada, **sem diagnóstico** (a causa não é conhecida; ver seção 6).
- Design Matrix e a abertura como central de sites devem ser preservados.
- A V1 e o ambiente antigo ficam intactos até a nova instalação ser validada.

**PENDENTE** (nenhum destes deve ser dado como resolvido)
| Pendência | Quem resolve |
|---|---|
| VPS: contratação (**não confirmada**), plano, região, sistema operacional, IPv6, acesso SSH | usuário |
| Supabase novo: plano, região, permissões do papel administrador | usuário cria; o preflight (somente leitura) informa |
| DNS: registros atuais de `app.johnyweb.com` e quem edita | usuário |
| E-mail: provedor e domínio remetente | usuário |
| Site piloto e integração do formulário | usuário |
| Backups: armazenamento externo; monitor externo | usuário |
| PageSpeed: criação e configuração da chave | usuário |
| Decisão: preservar ou não leads e histórico antigos | usuário |

## 2. Requisitos mínimos para esta versão do código

Derivados do código e dos testes; o que não foi medido está dito.

| Item | Mínimo | Observação |
|---|---|---|
| **Processo contínuo para o worker** | obrigatório | O worker é um laço permanente (checagens a cada poucos segundos, PageSpeed, e-mail, heartbeat). Não roda em hospedagem compartilhada nem em função que "dorme". |
| **Processo Node para a web** | Node 20+ (testado com 22) | `next start` atrás de um proxy HTTPS. |
| **Hostinger Premium** | **não atende** sozinha | Hospedagem compartilhada não mantém o worker. Mesmo que algum recurso de Node estivesse disponível nela (confirme com a Hostinger, não presumo), o worker continuaria sem lugar. Ela pode continuar existindo para o que já hospeda. |
| Servidor (VPS ou equivalente) | Linux, 2 vCPU, 2 GB de RAM **com 2 GB de swap** como piso; 4 GB recomendado | O `next build` chega perto de 2 GB; web e worker juntos em operação usam ~0,5–0,8 GB (estimativa, não medida em produção). Disco: 20 GB cobrem aplicação e releases; o dado fica no banco. |
| Rede do servidor | entrada 80/443; **saída 80/443 livre** (sites monitorados, Google, e-mail e o banco por TLS) | Sem proxy obrigatório: o `fetch` do Node não usa `HTTP(S)_PROXY`. IPv4 de saída (o pooler do Supabase atende IPv4). |
| PostgreSQL | 14+ (testado com 16), TLS, papel administrador com `CREATEROLE` e `BYPASSRLS`, banco já existente | Ver seção 5. |
| Latência servidor ↔ banco | idealmente < 30 ms de ida e volta | A central usa 4 idas e voltas por consulta: distância vira lentidão. O preflight mede. |
| HTTPS público | certificado válido para o endereço | Let's Encrypt via certbot (gratuito). |
| DNS | 1 registro A (e AAAA se houver IPv6) por endereço | Para o provisório, `piloto.johnyweb.com`. |
| E-mail transacional | provedor com API (Resend, Postmark) ou webhook | Necessário para alertas e para recuperação de senha. |
| Armazenamento externo | para o `.dump` diário | Fora da VPS e fora do banco. |

## 3. Configuração inicial sugerida

**Premissas (ajuste-as):** 50 sites no início, no máximo 200; checagem de disponibilidade a cada 5 minutos por site; PageSpeed diário (3 URLs × celular e desktop por site); cerca de 500 eventos por dia por site; retenção de 30 dias de checagens, 90 de eventos e 12 meses de medições.

| Parte | Sugestão |
|---|---|
| Servidor | 1 VPS Linux (Ubuntu LTS), 2 vCPU, 4 GB de RAM, 2 GB de swap, 40 GB de disco, na mesma região geográfica do banco |
| Processos | `johnyweb-web` (porta 3000 em loopback) e `johnyweb-worker`, dois serviços systemd separados, nginx na frente |
| Concorrência | `MONITOR_CONCORRENCIA=5` (até 50 sites) ou 10 (até 200); `PAGESPEED_CONCORRENCIA=2` |
| Conexões ao banco | web: 3 papéis × `DB_POOL_MAX=5`, pooler em modo transação; worker: 11, pooler em modo sessão |
| Banco | projeto Supabase novo, região a mais próxima da VPS; o tamanho esperado é de ordem de ~1 GB (50 sites) a ~3 GB (200) por causa dos eventos: **o plano precisa ser conferido contra isso** (estimativa grosseira; meça após uma semana) |
| Endereço | `piloto.johnyweb.com` (provisório) → `app.johnyweb.com` só depois da validação |

Cargas: 50 sites = 14.400 checagens/dia e 300 chamadas PageSpeed/dia; 200 sites = 57.600 e 1.200.

## 4. O que contratar ou configurar, em ordem

1. **Decidir a região** (a mais próxima de você e dos sites monitorados; Brasil, se disponível nos dois provedores). Define VPS e banco.
2. **Servidor** (VPS Linux) — *só depois de você aprovar*; alternativa: qualquer provedor com processo contínuo. Confirme IPv4, SSH e acesso `sudo`.
3. **Projeto Supabase novo** na conta nova, na região escolhida; baixar o certificado raiz; anotar o ref do projeto.
4. **Preflight do banco** (somente leitura) — informa permissões e latência. Veja seção 5.
5. **Registro DNS** `piloto.johnyweb.com` → IP da VPS (um registro novo; `app.johnyweb.com` não muda).
6. **Preparar o servidor e subir a V2 no provisório** (scripts de `deploy/`), com o banco novo ainda vazio. A primeira migração em produção só ocorre com sua aprovação explícita.
7. **Provedor de e-mail** e verificação do domínio remetente (SPF/DKIM exigem registros DNS: outra alteração de DNS, sua).
8. **Chave do PageSpeed** (projeto no Google Cloud).
9. **Armazenamento externo de backup** e **monitor externo** da central.
10. **Site piloto**: instalar o coletor e integrar o formulário (`docs/INSTALACAO-NO-SITE.md`).
11. **Validação** (`docs/VALIDACAO-PILOTO.md`) e medição de tempos. Só então decidir a troca de `app.johnyweb.com`.

## 5. Finalidade e custo recorrente

| Serviço | Para quê | Recorrente? |
|---|---|---|
| Servidor (VPS) | executar a web e o worker | **Sim** (mensal ou anual, conforme o plano) |
| Supabase (PostgreSQL) | guardar todos os dados | Plano gratuito pode servir para testar, mas tem limites de armazenamento e pode pausar por inatividade; para produção, **provavelmente plano pago recorrente** — confira no painel |
| Domínio `johnyweb.com` | endereços da central | Já existe; renovação anual |
| Certificado HTTPS (Let's Encrypt) | HTTPS | **Gratuito** |
| E-mail transacional | alertas e recuperação de senha | Geralmente há nível gratuito; acima dele, cobrança por volume — confira o provedor |
| Chave do PageSpeed (Google) | medição de velocidade | Há cota gratuita; confira os limites no console do Google |
| Armazenamento de backup | guardar os dumps fora da VPS | **Sim**, pequeno (por GB) |
| Monitor externo | avisar se a central cair | Geralmente há nível gratuito |
| Hostinger Premium | o que já existe | Mantida enquanto você quiser |

Não afirmo valores nem limites de plano de nenhum provedor.

### O preflight é somente leitura
`npm run db:supabase-preflight` **não altera nada**: abre uma conexão, consulta o catálogo (versão, papel administrador, TLS, papéis do Supabase, concessões) e mede a latência com uma transação que não grava. Ele nunca cria papel, nunca concede nem revoga permissão. O comando que altera permissões é **outro**, `db:supabase-endurecer` (revoga acesso de `anon`/`authenticated`), e só será proposto, explicado e rodado com a sua aprovação.

### Se faltar permissão: o que o preflight pode apontar e o que isso significaria
Nenhuma mudança é feita antes de você aprovar. Explicação das adaptações possíveis:

| Se o preflight mostrar | Por que importa | Adaptação possível (a decidir juntos) |
|---|---|---|
| Administrador **sem `CREATEROLE`** | `db:setup` não consegue criar os papéis `app_web`, `app_worker`, `app_ingest`, `app_forms` | Criar os papéis manualmente pelo SQL Editor do Supabase, com as senhas, e rodar só `db:migrate` (que não precisa criar papéis, exceto os `nologin` da migração 0005, que também exigem `CREATEROLE` — nesse caso criá-los antes) |
| Administrador **sem `BYPASSRLS`** | As tabelas têm RLS **forçada**; sem bypass, bootstrap, importação e `pg_restore` falham. Só um superusuário concede `BYPASSRLS`, e no Supabase você não é superusuário | Hoje não há adaptação segura pronta. Opções a avaliar, cada uma com custo: (a) executar essas operações pontuais como dono da tabela alternando `NO FORCE ROW LEVEL SECURITY` só durante a operação; (b) criar funções administrativas `SECURITY DEFINER` para bootstrap/importação; (c) trocar de provedor de banco. Qualquer uma exige código novo e testes — **não será implementada sem decisão sua**. |
| Papéis `anon`/`authenticated` com concessões em `public` | A API de dados do Supabase poderia alcançar tabelas da central | `db:supabase-endurecer` (revoga) e, no painel, desativar a Data API se o plano permitir. A RLS forçada já bloqueia as linhas, é uma camada extra. |
| Pooler em modo transação para o worker/admin | recursos de sessão indisponíveis | Usar o modo sessão (porta de sessão do pooler) para esses dois |
| Host só IPv6 e VPS sem IPv6 | a VPS não alcança o banco | Usar o pooler (IPv4) |
| Latência > ~30 ms | páginas lentas só por rede | Mudar a região do servidor ou do projeto |

## 6. Lentidão da versão atual (sem diagnóstico)
Não se sabe se a lentidão é da V1 em produção, da V2 em desenvolvimento ou de algo na hospedagem; **este documento não assume causa**. O que está pronto para diagnosticar quando houver ambiente:
- `npm run medir` (login, listagem e cada aba, com p50/p95 e uma base sem banco).
- `DB_LOG_LENTO_MS` (duração e número de consultas por transação).
- `db:supabase-preflight` (latência de ida e volta ao banco).
- Hipótese a testar primeiro, não conclusão: distância servidor ↔ banco × 4 idas e voltas por consulta.
Para a V1 atual, a mesma medição de navegador (`npm run medir` adaptado ao login dela) pode registrar uma linha de base antes de qualquer troca; isso precisa ser combinado, porque exigiria uma conta de leitura nela.

## 7. O que já está pronto no repositório (sem infraestrutura)
- `deploy/`: serviços systemd (web e worker), modelos de variáveis sem valores, nginx, scripts de provisionamento, deploy por release e retorno.
- `scripts/supabase.ts`: preflight (leitura) e endurecimento (altera, separado).
- TLS único com CA por arquivo, `db:setup` sem superusuário e `DB_ROLE_SUFFIX`, `DB_POOL_MAX`, `DB_LOG_LENTO_MS`.
- `npm run medir` para medir tempos.
- `docs/IMPLANTACAO-VPS-SUPABASE.md` (roteiro detalhado), `docs/ROTEIRO-PILOTO.md`, `docs/VALIDACAO-PILOTO.md` (tudo PENDENTE), `docs/COMPATIBILIDADE.md`, `docs/BACKUP.md`.
- Testado só em emulação local. Nada foi executado contra Supabase, VPS ou DNS reais.

**Pode ser feito sem infraestrutura, se você quiser**: revisar os scripts de `deploy/` linha a linha; testar o `deploy.sh` num contêiner local; escrever o procedimento de medição da V1; desenhar (sem implementar) a adaptação para o caso sem `BYPASSRLS`; preparar o modelo de importação de leads e histórico **depois** da decisão sobre eles.

## 8. Fora do alcance desta etapa
Contratar serviços, criar o projeto Supabase, alterar DNS, rodar migrações em produção, publicar a V2 ou desativar a V1 — nada disso será feito sem a sua instrução explícita.
