# Progresso — JohnyWeb V2

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
- **Fase 2**: agenda + fila com lease, verificador HTTP seguro (anti-SSRF, DNS fixado, limites), incidentes (2 falhas), TLS, manutenção, alertas internos, retenção. Testes U01–U08, N01.
- **Fase 3**: PageSpeed (chave, até 3 URLs, mobile/desktop, fila dimensionada, CrUX separado). P01–P03.
- **Fase 4**: coletor versionado, instalação guiada, eventos de teste isolados, formulários (3 modos), contatos, horários, atribuição, exportação. E01–E04, F01–F04, T01–T03.
- **Fase 5**: relatório imprimível, CSV, adaptador de e-mail, preferências de alerta, backups/restauração, validação visual final. R01, X01.
- **Depende de credencial/ambiente**: chave PageSpeed, provedor de e-mail, hospedagem com processo contínuo para o worker, monitor externo independente da própria central.
- **Não feito nesta fase**: recuperação de senha por e-mail; convite de outros usuários pela interface; importação de dados da V1.
