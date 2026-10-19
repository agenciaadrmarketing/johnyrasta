# Operação — instalar, rodar, testar, implantar

## Requisitos
- Node.js 20+ (desenvolvido com 22), npm.
- PostgreSQL 14+ (desenvolvido com 16). Local ou gerenciado (Supabase, Neon, RDS…).
- Para o worker em produção: ambiente com processo contínuo (VPS, container, serviço de worker). Hospedagem só de estáticos não serve.

## Primeira vez
```bash
cp .env.example .env.local        # preencha DATABASE_URL_ADMIN, DATABASE_URL, DATABASE_URL_WORKER, SESSION_SECRET
npm install
npm run db:setup                  # cria database, papéis app_web/app_worker e aplica migrations/
BOOTSTRAP_ACCOUNT="Minha agência" BOOTSTRAP_NAME="Seu nome" BOOTSTRAP_EMAIL="voce@agencia.com" BOOTSTRAP_PASSWORD="…" npm run db:bootstrap
npm run dev                       # http://localhost:3000
npm run worker                    # em outro terminal: heartbeat (Fase 1), verificações (Fase 2)
```
Sem `BOOTSTRAP_*` no ambiente, o bootstrap pergunta no terminal. Ele se recusa a rodar se já existir usuário.

### Demonstração (opcional, nunca em produção)
`npm run db:demo` cria `demo@johnyweb.local / demo-johnyweb-2026` numa conta marcada como demonstração (faixa visível na interface).

## Comandos
| Comando | O que faz |
|---|---|
| `npm run dev` | aplicação web em desenvolvimento (sem CSP, por causa do `eval` do dev server) |
| `npm run build && npm start` | pacote de produção (CSP bloqueante com nonce) |
| `npm run worker` | processo do worker (`DATABASE_URL_WORKER`) |
| `npm run db:migrate` | aplica migrações pendentes (`DATABASE_URL_ADMIN`) |
| `npm run typecheck` · `npm run lint` · `npm run design` | TypeScript, ESLint (inclui regras do compilador React), verificador do design system |
| `npm run test:unit` | regras puras |
| `npm run test:integration` | PostgreSQL real: recria `johnyweb_test` com as migrações e testa RLS/invariantes |
| `npm run test:e2e` | Playwright contra `next start` na porta 3100 (cria contas `e2e-a`/`e2e-b` no banco de `.env.local`) |
| `npm run verificar` | typecheck + lint + design + testes |

## Variáveis
Documentadas em `.env.example`. Segredos só no gestor da hospedagem.

## Implantação (proposta; não executada)
1. Banco gerenciado: rode `npm run db:setup` a partir de uma máquina com acesso administrativo (ou aplique `migrations/` com o papel administrador e crie os papéis à mão com as senhas das URLs).
2. Web: `npm run build` + `npm start` (ou plataforma Next). Variáveis: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`.
3. Worker: serviço separado com `npm run worker` supervisionado (restart automático). Variável: `DATABASE_URL_WORKER`, `WORKER_ID`.
4. Monitor externo da própria central (UptimeRobot, Better Stack ou similar): se web e worker caírem juntos, eles não alertam sobre si mesmos.
5. Backup do banco com restauração testada antes de ativar para a carteira.
6. Rollback: migrações são aditivas; voltar a versão anterior da aplicação não exige reverter o banco.

## Rollback da Fase 1
Não há ambiente antigo tocado. Para desfazer uma instalação local: `npm run db:setup -- --drop` (proibido com `NODE_ENV=production`).

## Nota sobre o Playwright neste ambiente
Se o Chromium instalado não for o da versão do pacote, aponte o binário: `PW_EXECUTABLE=/caminho/para/chrome npm run test:e2e`.
