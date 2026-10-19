# Progresso — JohnyWeb V2

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
- **Fase 3**: PageSpeed (chave, até 3 URLs, mobile/desktop, fila dimensionada, CrUX separado). P01–P03.
- **Fase 4**: coletor versionado, instalação guiada, eventos de teste isolados, formulários (3 modos), contatos, horários, atribuição, exportação. E01–E04, F01–F04, T01–T03.
- **Fase 5**: relatório imprimível, CSV, adaptador de e-mail, preferências de alerta, backups/restauração, validação visual final. R01, X01.
- **Depende de credencial/ambiente**: chave PageSpeed, provedor de e-mail, hospedagem com processo contínuo para o worker, monitor externo independente da própria central.
- **Não feito nesta fase**: recuperação de senha por e-mail; convite de outros usuários pela interface; importação de dados da V1.
