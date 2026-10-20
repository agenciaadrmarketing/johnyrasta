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
| `npm run db:backup` · `npm run db:restaurar -- --para <banco>` | backup lógico e restauração verificada; veja `docs/BACKUP.md` |
| `npm run typecheck` · `npm run lint` · `npm run design` | TypeScript, ESLint (inclui regras do compilador React), verificador do design system |
| `npm run test:unit` | regras puras |
| `npm run test:integration` | PostgreSQL real: recria `johnyweb_test` com as migrações e testa RLS/invariantes |
| `npm run test:e2e` | Playwright contra `next start` na porta 3100 (cria contas `e2e-a`/`e2e-b` no banco de `.env.local`) |
| `npm run verificar` | typecheck + lint + design + testes |

## PageSpeed (Fase 3)
- Defina `PAGESPEED_API_KEY` no ambiente da aplicação (estado na tela) e do worker (medições). Sem ela nada é medido.
- O worker agenda, uma vez por dia (UTC), uma medição por URL × dispositivo e drena com `PAGESPEED_CONCORRENCIA` (padrão 2). Em Configurações, "Fila parada" indica medições devidas há mais de 2 h sem nenhuma concluída: confira a cota da chave no console do Google e o log do worker.
- "Medir agora" só enfileira (uma vez a cada 30 min por URL). Quem mede é o worker.

## Coletor e formulários (Fase 4)
- Defina `DATABASE_URL_INGEST` e `DATABASE_URL_FORMS` (papéis criados por `npm run db:setup`). Os endpoints públicos usam só esses papéis.
- `APP_URL` precisa ser o domínio público da central: os snippets da aba Instalação apontam para ele.
- O coletor é `/c.v1.js` (CORS aberto, cache de 5 min). Uma versão nova vai para `/c.v2.js`; a antiga continua servida até a carteira migrar.
- Limites em memória por instância: 240 req/min por IP e 120 por site+IP na coleta; 30 por site+IP em formulários; corpo até 64 KB (coleta) e 32 KB (formulários).
- Instalação piloto: um site, aba Instalação → teste com token → página `/teste/<publicId>` ou o próprio site com `?jw_test=<token>`. Só amplie para a carteira depois de ver visita, clique e formulário confirmados e um contato real chegando.

## Variáveis
Documentadas em `.env.example`. Segredos só no gestor da hospedagem.

## O worker (Fase 2)
- `npm run worker` inicia o processo. Ele reivindica monitores devidos a cada 5 s, verifica com concorrência `MONITOR_CONCORRENCIA` (padrão 5), grava checagens, incidentes e alertas, apaga checagens com mais de 30 dias e se apresenta por heartbeat a cada 30 s.
- Pode haver mais de uma instância: a fila usa lease; dois workers nunca pegam o mesmo monitor.
- Se o worker morrer no meio de uma checagem, o lease vence em 90 s e outro worker (ou ele mesmo, reiniciado) retoma.
- `MONITOR_EXCECOES_DE_REDE` libera IPs privados por lista explícita. Em instalação aberta, deixe vazio. Configure também bloqueio de egress na hospedagem para redes privadas e metadata de nuvem: é a segunda camada.
- Capacidade: 100 sites a cada 5 min são 20 checagens/min; com 10 s de timeout e concorrência 5, o pior caso cabe. Acompanhe "Fila de verificações" em Configurações: "atrasados" acima de zero por mais de um ciclo pede mais concorrência ou mais uma instância.

### Teste de aceite ao vivo (opcional)
```bash
echo "127.0.0.1 piloto.exemplo.test" >> /etc/hosts     # ou um nome que resolva para um servidor seu
# suba um servidor HTTP na porta 80 que devolva 200/500 conforme um arquivo de controle
MONITOR_EXCECOES_DE_REDE=127.0.0.1 npm run worker
```
Cadastre `http://piloto.exemplo.test/` como site com monitor, alterne o servidor para 500 e observe em Disponibilidade: suspeita → confirmado em duas checagens → recuperado ao voltar para 200. Em Atenção aparece um alerta de abertura e, depois, um de recuperação.

## Notificações por e-mail (Fase 5)
- Preferências em Configurações → Notificações (destinatários e tipos) e por site em Disponibilidade. Sem `EMAIL_PROVIDER` no ambiente do worker nada é enviado e a tela diz isso; os alertas continuam em Atenção.
- Provedores: `resend`, `postmark`, `webhook` (qualquer destino HTTP) e `log` (só desenvolvimento). Variáveis em `.env.example`. O worker precisa de saída direta para a API do provedor (o `fetch` do Node não usa proxy).
- Entregas e falhas aparecem em Configurações; o outbox nunca reenvia o mesmo alerta para o mesmo destinatário.

## Relatórios (Fase 5)
- `/relatorios`: por site ou por cliente, período 7/30/90 (mesma janela das abas e do CSV) ou personalizado no fuso do site. Impressão pelo navegador (Ctrl+P ou botão Imprimir); PDF automático no servidor não faz parte desta versão.

## Implantação
Procedimento completo, variáveis por serviço, dimensionamento, rollback e limites conhecidos: `docs/IMPLANTACAO.md`. Lista verificável antes de ativar: `docs/CHECKLIST-PRE-PRODUCAO.md`. Backup e restauração: `docs/BACKUP.md`. Instalação do coletor e formulários num site de cliente: `docs/INSTALACAO-NO-SITE.md`.

Resumo:
1. Banco gerenciado: rode `npm run db:setup` a partir de uma máquina com acesso administrativo (ou aplique `migrations/` com o papel administrador e crie os papéis à mão com as senhas das URLs).
2. Web: `npm run build` + `npm start` (ou plataforma Next). Variáveis: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`.
3. Worker: serviço separado com `npm run worker` supervisionado (restart automático). Variável: `DATABASE_URL_WORKER`, `WORKER_ID`.
4. Monitor externo da própria central (UptimeRobot, Better Stack ou similar): se web e worker caírem juntos, eles não alertam sobre si mesmos.
5. Backup do banco com restauração testada antes de ativar para a carteira.
6. Rollback: não existe migração "down", e "aditiva" não garante que o código anterior funcione (migrações também mudam permissões). Só se volta a uma versão listada como verificada em `docs/COMPATIBILIDADE.md`, sem reverter o banco. Restaurar backup só em caso de corrupção ou perda, sempre num banco novo (`docs/BACKUP.md`).

## Rollback da Fase 1
Não há ambiente antigo tocado. Para desfazer uma instalação local: `npm run db:setup -- --drop` (proibido com `NODE_ENV=production`).

## Nota sobre o Playwright neste ambiente
Se o Chromium instalado não for o da versão do pacote, aponte o binário: `PW_EXECUTABLE=/caminho/para/chrome npm run test:e2e`.
