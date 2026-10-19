# Decisões de arquitetura e produto — JohnyWeb V2

Registro cronológico. Cada decisão diz o que foi escolhido, o que foi descartado e por quê. Sem segredos.

## 2026-10-19 — Fase 1

### D01. Projeto novo, repositório novo, banco novo
O pacote V1 é referência técnica e fonte do design system. Nada dele roda contra produção; nenhum script antigo (seed, reset, migrações) é reaproveitado. Migrações V2 começam em `0001`.

### D02. Pilha: Next.js 16 + React 19 + TypeScript 5 + PostgreSQL 16, sem ORM
Versões verificadas no registro npm em 19/10/2026, não copiadas do lockfile antigo. SQL explícito em `migrations/` e nas consultas: a RLS e as chaves compostas são o contrato, e um ORM esconderia exatamente isso. `zod` fica disponível para contratos de API (Fase 4); na Fase 1 a validação pura mora em `src/shared/validation`.

### D03. Estrutura de execução: web + worker + banco
Três processos. O worker (`npm run worker`) é separado da aplicação web e se apresenta por heartbeat no banco; a central mostra "nunca visto" ou "sem sinal há X" em Configurações e em Atenção. A central nunca dispara verificações a partir de uma aba aberta. Hospedagem só de arquivos estáticos não atende.

### D04. Sessão opaca no banco, não JWT
A V1 assinava um JWT com o id do usuário. Na V2 o cookie leva um token aleatório e o banco guarda o SHA-256 dele (`auth_sessions`). Motivo: revogar tem efeito imediato; "encerrar as outras sessões" e "trocar senha encerra as outras" viram uma linha de SQL. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, 14 dias.

### D05. Sem senha padrão em lugar nenhum
A V1 trazia seed com credenciais fixas e um "aviso global" com desativação por frase no frontend. A V2 cria o proprietário por `npm run db:bootstrap`, que lê a senha do ambiente ou de prompt e se recusa a rodar se já houver usuário. A conta de demonstração (`npm run db:demo`) é separada, marcada `is_demo`, tem faixa visível e nunca é reserva de erro.

### D06. RLS forçada + papéis por finalidade + chaves compostas
`app_web` enxerga só `app.current_account_id()`; `app_worker` (Fase 2) lê sites e monitores e grava heartbeat, sem acesso a usuários, sessões ou contatos. Login e sessão passam por funções `SECURITY DEFINER` estreitas com `search_path` fixo. Além da RLS, `sites.client_id` referencia `(client_id, account_id)` em `clients`: um site nunca aponta para cliente de outra conta mesmo se o código errar. Testado em `tests/integration/isolamento.spec.ts`.

### D07. Política de domínio
`www.` é o mesmo site e some do domínio; qualquer outro subdomínio é outro site. Único por `(account_id, domain)` entre sites ativos; o banco também recusa domínio não normalizado (`check`). Só HTTP/HTTPS, sem porta, sem credenciais, sem IP. Bloqueio de destino privado (SSRF) é responsabilidade do verificador da Fase 2, não do cadastro.

### D08. Situação do site é UMA função pura
`situacaoDoSite()` recebe fatos (monitor, última checagem, incidente, manutenção) e devolve estado, rótulo, tom, frase, próxima ação e prioridade. Linha de projeto, resumo e Atenção consomem a mesma função; por isso nunca discordam. Na Fase 1 toda checagem é `null`, logo todo site monitorado é "Nunca verificado" — e não "Online".

### D09. Interface: central de projetos, não dashboard
Navegação com cinco destinos (Meus sites, Atenção, Clientes, Relatórios, Configurações); no celular, quatro na barra inferior. Abertura = busca + filtros em pílula + uma linha por projeto (iniciais, nome, cliente, domínio, estado com texto, "verificado há", frase, próxima ação, ações). Sem cartões de totais, sem gráficos na abertura. Gráficos entram nas abas Velocidade e Botões e horários (Fases 3/4).

### D10. Design system Matrix portado valor a valor
`src/styles/theme.css` é o da V1 até a seção dos cartões KPI, mais um bloco V2 (linha de projeto, filtros, selo de estado, botões, lista de trabalho, campos) que usa apenas tokens. Fontes locais (Inter, JetBrains Mono), `ChuvaMatrix`, `TextoMatrix`, `ControlesAparencia`, `Marca`, `TelaDeErro`, cartão de vidro do login: intactos. O bloco "Aviso Mega Ads" ficou de fora (comportamento de bloqueio, não design). `npm run design` (portado para `tools/conferir-design.mjs`) confere paridade de tokens, contraste 4,5:1 em 39 pares por tema, escala fechada e cópias vigiadas.

### D11. Preferências de aparência via `useSyncExternalStore`
A V1 lia `data-tema`/`data-fx` com `useEffect + setState`; o compilador do React 19 (lint do Next 16) reprova. A V2 observa os atributos do `<html>` com `MutationObserver` num hook (`usePreferencia`). Mesmo comportamento: aplicado antes da primeira pintura, persistido em `localStorage`, respeita `prefers-reduced-motion`.

### D12. CSP com nonce, só em produção
Igual à V1 em espírito: `proxy.ts` (nome do Next 16 para middleware) gera nonce por requisição e aplica CSP bloqueante em `next start`; `next dev` fica sem CSP por causa do `eval`. `style-src 'unsafe-inline'` é consequência da arquitetura visual (estilos inline + classes).

### D13. Scrypt com N=2^15 e `maxmem` explícito
N=2^15 exige 33,5 MB e o Node limita a 32 MB por padrão; o parâmetro `maxmem` sobe para 64 MB. Descoberto ao rodar o bootstrap — registrado para ninguém "resolver" baixando N.

### D14. O que a Fase 1 NÃO afirma
Nenhuma disponibilidade, nota, visita ou contato é exibido. As abas Disponibilidade, Velocidade, Contatos, Botões e horários e Instalação existem e dizem, cada uma, o que falta e em que fase chega. Relatórios idem.

### Descartado nesta fase
- Agendamento por GitHub Actions/cron de hospedagem como mecanismo principal (atraso não medido; fica como fallback documentado).
- Redis/BullMQ (fila em PostgreSQL com lease atende o volume previsto; reavaliar na Fase 3 com a quota real do PageSpeed).
- Push do navegador (depende de permissão; não bloqueia monitor).
- Recuperação de senha por e-mail (exige provedor; Fase 5). O link não aparece na tela de login para não prometer o que não existe.
