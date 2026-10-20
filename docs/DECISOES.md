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

## 2026-10-19 — Fase 2

### D15. A fila é a tabela de monitores, com lease
`next_check_at` diz quando é devido; `lease_token`/`lease_until` dizem quem processa. Reivindicação com `FOR UPDATE SKIP LOCKED`; toda gravação confere o token. Um worker que morreu no meio perde o lease em 90 s e outro retoma; a gravação tardia do primeiro é descartada (testado, U07). Sem Redis: o volume previsto (centenas de monitores a cada 5 min) cabe folgado no Postgres.

### D16. Verificador próprio sobre `http`/`https` do Node, não `fetch`
Precisávamos de três coisas que o `fetch` esconde: fixar a conexão no IP validado (`lookup` injetado), ler o certificado do socket e cortar a leitura por bytes lidos. Política de rede em módulo puro (`src/modules/monitoring/rede.ts`), consultada antes de resolver, depois de resolver (todos os endereços) e a cada redirecionamento. Um endereço privado no conjunto bloqueia o host inteiro.

### D17. Exceções de rede são explícitas e ruidosas
`MONITOR_EXCECOES_DE_REDE` libera IPs privados por lista. O worker avisa no log ao iniciar com a lista preenchida. Sem ela, o verificador nunca conecta em loopback, redes privadas, link-local, metadata de nuvem, CGNAT, faixas especiais, IPv4 mapeado em IPv6, NAT64, 6to4 ou multicast. Portas fora de 80/443 só para hosts da lista. O bloqueio de egress na hospedagem continua recomendado como segunda camada.

### D18. Máquina de estados pura, uma por checagem
`transicao()` recebe o monitor, o resultado e o relógio; devolve a ação (abrir, confirmar, incrementar, fechar isolada, recuperar), os alertas a inserir e os a resolver. Regras: 1ª falha abre incidente não confirmado; 2ª consecutiva sem lacuna maior que 3 intervalos confirma e gera UM alerta; sucesso recupera e gera alerta de recuperação. Manutenção registra tudo e suprime alertas. A lacuna reinicia a contagem.

### D19. Deduplicação por chave, no banco
`alerts.dedupe_key` é única por conta: `incidente:<id>:confirmado`, `incidente:<id>:recuperado`, `tls:<monitor>:<notAfter>:<faixa>`, `atraso:<monitor>:<última checagem>`. Dez checagens falhas do mesmo incidente produzem uma linha (N01, testado contra o Postgres). Entrega por canal (e-mail) é outbox separado, Fase 5.

### D20. Checagem atrasada é alerta de episódio, resolvido ao retomar
O worker, ao pegar um monitor cuja última checagem tem mais de 3 intervalos, grava o alerta já resolvido: fica o registro de que houve um buraco, sem ruído aberto. A central calcula o estado "verificação atrasada" ao vivo pela mesma regra (`verificacaoAtrasada`) — por isso um worker parado nunca deixa um verde antigo na tela.

### D21. "Checagens bem-sucedidas no período", nunca "uptime"
A aba mostra a fração de amostras que respondeu, o número de amostras e as lacunas de cobertura. Não é disponibilidade contínua e a tela diz isso. Verificação manual só enfileira (cooldown de 2 min), nunca aceita destino arbitrário.

### D22. Retenção
Checagens detalhadas: 30 dias (o worker apaga a cada hora). Incidentes e alertas ficam.

## 2026-10-19 — Fase 3

### D23. Fila genérica `audit_jobs` com lease e chave lógica
Separada da fila de monitores: frequência, custo e significado são outros. Chave `pagespeed:<url>:<dispositivo>:<dia>` única entre trabalhos ativos; medição manual usa `manual-<carimbo>` com cooldown de 30 min por URL. Reivindicação com `SKIP LOCKED`, lease de 180 s (uma medição leva 30 a 60 s), gravação confere o token.

### D24. Sem chave, nada acontece — e a tela diz isso
`PAGESPEED_API_KEY` ausente: o worker não agenda, não consome e loga o motivo; a aba Velocidade e Configurações mostram "não configurado". URLs podem ser escolhidas antes da chave. Nenhum estado de erro vira nota.

### D25. Estados de falha distintos, retentativa só para transitórios
`cota` (429 ou 403 com "quota"), `timeout` (504/408/abort) e 5xx genérico → retentativa com backoff exponencial com jitter (2, 4, 8 min…), até 4 tentativas, depois `erro` registrado. `pagina_inacessivel` (Lighthouse não carregou o documento) e `bloqueado` (400/403) falham de vez. `resposta_parcial` grava o que veio e lista o que faltou.

### D26. Laboratório e campo são tabelas diferentes
`performance_runs` guarda Lighthouse (notas 0–100, LCP/CLS/TBT/FCP/SI simulados, até 10 oportunidades com economia individual, versão do Lighthouse, configuração). `crux_snapshots` guarda CrUX (p75 de LCP, INP, CLS) com `scope` `url` ou `origin` — a fonte sinaliza a queda para origem e a tela mostra "Origem". INP só vem do campo; TBT nunca é apresentado como INP. CrUX ausente é "dados insuficientes", não zero.

### D27. Regressão é indicação, não alerta
Queda de 10 pontos ou mais de performance em relação à última medição OK da mesma URL e dispositivo marca `regression`. A aba e o Resumo mostram "possível regressão" e pedem nova medição. Alerta automático de regressão fica para quando houver duas medições comparáveis em sequência (decisão adiada de propósito: a variabilidade do Lighthouse é conhecida).

### D28. Economias não se somam
As oportunidades aparecem individualmente, ordenadas; a tela avisa que se sobrepõem.

### D29. Capacidade
Agenda diária por URL × dispositivo. Concorrência padrão 2 no worker (`PAGESPEED_CONCORRENCIA`). Para 100 sites × 3 URLs × 2 dispositivos (600/dia) a 45 s cada, concorrência 2 drena em ~3,75 h; a cota efetiva da chave é o limite real e só se conhece no console do Google. "Fila parada" (devidas há mais de 2 h sem nenhuma concluída) gera um alerta por dia.

## 2026-10-20 — Fase 4

### D30. Dois papéis públicos, dois endpoints, nenhum com acesso além do próprio trabalho
`app_ingest` (eventos) lê sites e grava sessões e eventos; não enxerga contatos, usuários nem incidentes. `app_forms` (formulários) grava submissões, contatos e identidades e lê eventos da sessão para atribuição; não enxerga usuários. Testado por permissão negada.

### D31. Deduplicação antes de qualquer efeito colateral
`events (site_id, event_id)` é único; a ingestão consulta a chave antes de abrir ou estender sessão (E01). Sessões têm `(site_id, session_key)` único e `FOR UPDATE`; dois eventos simultâneos do mesmo visitante produzem uma sessão (E02). Evento atrasado depois da expiração não estende `last_seen_at` (E03).

### D32. O coletor não lê formulários
`c.v1.js` registra `page_view` (inclusive rotas SPA), `click` (por `data-track-id` ou detecção automática de WhatsApp, telefone e e-mail, marcada como tal) e `form_attempt` (só o gesto). Só três UTMs; path sem query/hash; referrer reduzido ao host. `data-consent="exigido"` segura o identificador persistente até `jw('consent')`. Versionado no nome do arquivo.

### D33. Três modos de formulário, e só um prova entrega
Endpoint da central → "contato recebido". Webhook assinado (HMAC do corpo com timestamp e nonce, janela de 5 min, replay recusado) → "destino confirmado", o único caminho para esse status. Cópia auxiliar → "recebido" ou "falha no destino" quando o site informa; nunca "confirmado" (F02). A origem da evidência aparece em cada envio.

### D34. Idempotência de submissão e identidade com conflito explícito
`(site_id, submission_id)` único: reenvio devolve o mesmo resultado (F01). E-mail e telefone são normalizados (país padrão do site). E-mail → A e telefone → B registram conflito, a submissão fica com A e nada é mesclado até o operador decidir (F03); a mesclagem é ação explícita e auditada.

### D35. Diagnóstico fora de tudo
Token de 1 h marca eventos e submissões como `is_test`: fora das contagens, sem contato, sem "primeiro contato real" (F04). A página pública `/teste/<publicId>` usa o coletor real.

### D36. Atribuição ao último clique, com denominador honesto
Último clique da mesma sessão até 30 min antes; senão "sem atribuição" (T03). A tabela de botões mostra cliques, sessões com clique, contatos atribuídos e sessões que clicaram E converteram — nunca "CTR", porque impressões não são medidas.

### D37. Horários são contagens, no fuso do site, com aviso de amostra
UTC no banco; `at time zone <fuso IANA>` na consulta (T01). Com menos de 30 ações no período a tela avisa que "melhor horário" não é conclusão confiável.

### D38. Coleta interrompida só com volume regular
Média ≥ 20 eventos/dia nos 7 dias anteriores e zero nas últimas 24 h → um alerta por dia. Sites de baixo tráfego nunca alertam por isso.

### D39. Retenção
Eventos detalhados 90 dias, medições 12 meses, checagens 30 dias (worker, de hora em hora). Submissões e contatos ficam até o operador excluir (exclusão e política explícita ficam para a Fase 5).

## 2026-10-20 — Fase 5

A Fase 5 foi construída em quatro frentes paralelas (relatórios, notificações, contatos e permissões, operação), mescladas e depois submetidas a revisão adversarial. As decisões abaixo consolidam o que cada frente registrou; a numeração segue a sequência do documento.

### Notificações por e-mail

### D40. Entrega é outbox separado do alerta
`alert_deliveries` com `UNIQUE (alert_id, channel, recipient)` é o contrato de não reenvio: a dedupe do alerta (Fase 2) garante uma condição = um alerta; a unicidade da entrega garante um alerta = uma entrega por caixa de entrada, mesmo com dez rodadas ou dois workers. Abertura e recuperação são alertas distintos e, por isso, duas entregas.

### D41. Corte temporal pelas preferências
Só alertas criados DEPOIS da última gravação das preferências (`notification_settings.updated_at`) e ainda no estado `aberto` são enfileirados. Ligar o e-mail ou trocar destinatários nunca despeja histórico antigo; o que já foi resolvido não vira e-mail. Consequência registrada: `verificacao_atrasada`, que o worker grava já resolvido (D20), não sai por e-mail; continua na lista por completude.

### D42. Sem provedor, o alerta fica registrado como descartado
Sem `EMAIL_PROVIDER` o outbox cria as entregas já como `descartado` (com o motivo em `last_error`), para que ligar o provedor depois não despeje uma fila acumulada: a unicidade alerta/canal/destinatário cobre o alerta. A preferência pode ser salva antes e a tela diz que nada será enviado até configurar o provedor. (Substitui a versão original, "não enfileira nada", que deixava o alerta elegível quando o provedor fosse ligado.)

### D43. Dois processos, dois ambientes, os dois na tela
Configurações mostra o que a aplicação lê de `EMAIL_PROVIDER` e o que o worker informou no heartbeat (provedor, pendentes, falhas em 24 h), com aviso quando divergem. Quem envia é o worker.

### D44. Adaptador só devolve sucesso com 2xx do provedor
429, 408, 5xx, timeout (15 s) e erro de rede são transitórios, com backoff 1·2·4·8·16 min (jitter de ±25%) até 5 tentativas, depois `falhou` definitivo; outros 4xx falham na hora. O modo `log` marca como enviado sem entregar nada e o worker avisa disso ao iniciar: é só para desenvolvimento.

### D45. Reivindicação de entregas com lease implícito
`FOR UPDATE SKIP LOCKED` e reserva de 10 min em `next_attempt_at`, sem estado "processando": se o worker morrer no meio do envio, a entrega volta à fila sozinha. Se a preferência da conta mudar entre enfileirar e enviar, a entrega vira `descartado` em vez de sair.

### D46. Entrega referencia alerta por chave composta
`alert_deliveries (alert_id, account_id)` → `alerts (id, account_id)`; `alerts` ganhou a unicidade correspondente. Mesma regra de `sites` → `clients` (D06): uma entrega nunca aponta para alerta de outra conta, mesmo que o código erre.

### D47. Preferência por site: sem linha = ligado
A linha só existe para registrar a decisão de desligar ou religar. Alertas sem site (fila parada) seguem só a conta. A gravação usa `insert … select from sites`, para que um id de outra conta vire "nenhuma linha" em vez de erro de chave estrangeira.

### D48. Link da mensagem por tipo
Alertas de monitoramento → `/sites/<id>/disponibilidade`; `coletor_parado` → `/sites/<id>/instalacao`; sem site → `/atencao`. Sem `APP_URL` a mensagem leva só o caminho e diz que falta a variável, em vez de inventar um domínio.

### D49. Rótulos de categoria de falha duplicados de propósito
Os rótulos usados no corpo do e-mail moram em `notifications/mensagem.ts` (módulo puro) porque `monitoring/consultas.ts` é `server-only` e o worker não pode importá-lo. Se a lista mudar lá, muda aqui.

### Relatórios

### D50. Período padrão é janela móvel; período personalizado é dia de calendário no fuso do site
`?dias=7|30|90` termina em "agora", exatamente como `periodoDeDias` da aba Botões e horários e do CSV de eventos: é o único jeito de relatório, aba e CSV mostrarem os mesmos números. `?de/?ate` usa dias de calendário no fuso IANA do site (00:00 a 23:59:59.999 convertidos para UTC), no máximo 366 dias; fim no futuro é cortado em agora e o rótulo diz.

### D51. O relatório não tem SQL próprio
`relatorioDoSite` compõe as funções de consulta das abas; o teste R01 (`tests/integration/relatorio.spec.ts`) compara campo a campo com essas funções chamadas diretamente para o mesmo período. Recortes feitos em código puro (`reports/regras.ts`): incidentes que tocam o período, horas mais ativas, agrupamento por evidência, remoção da mensagem livre.

### D52. Relatório do cliente
Resolve o período no fuso do primeiro site ativo; se os sites do cliente usam fusos distintos, a tela avisa em vez de fingir que são iguais. Sites arquivados ficam fora do relatório do cliente e podem ser abertos pelo relatório do site, com aviso de arquivado.

### D53. CSV a partir do relatório
Eventos só com período padrão (a rota aceita 7/30/90; um arquivo com números diferentes da tela seria pior que nenhum). Contatos sempre, rotulado como "todos os contatos do site, sem recorte de período", porque essa rota não tem período.

### D54. Impressão remapeia para o tema claro
Dentro de `@media print`, tokens de texto, borda, estado e paleta de dados recebem os valores do tema claro (a legenda do escuro sobre papel ficava em cerca de 2,9:1). Cartões podem quebrar entre páginas, nunca no meio de uma linha; `thead` repetido; quebra de página entre sites. A seção de disponibilidade usa `resumoDeChecagens` contada a partir de agora (assinatura existente) e declara isso em texto; a fração no período exato fica para uma consulta futura.

### Contatos: exclusão, retenção e permissões

### D55. Excluir contato é anonimizar, nunca apagar a linha
Identidades removidas, nome nulo, `fields = {}` nos envios do contato; `occurred_at`, `page_path`, `attribution`, `attributed_event_id` e `is_new_lead` ficam, então nenhuma contagem ou horário do relatório muda. Conflitos abertos que envolvem o contato fecham como `contato_excluido`. Idempotente; id de outra conta devolve "não encontrado", nunca 403.

### D56. Depois da exclusão, o identificador recomeça
Novo envio com o mesmo e-mail ou telefone cria contato novo com `is_new_lead = true`. Lembrar o identificador para dizer "é a mesma pessoa" exigiria guardar o próprio dado que acabou de ser apagado.

### D57. O worker anonimiza sem conseguir ler dado pessoal
Grants por coluna: `select` em `contacts` sem `name`, em `contact_identities` sem `value`; `update` só nas colunas da anonimização. Corrigido na migração 0008: o worker tinha `select` em `submissions` inteira (incluindo `fields`, com dado pessoal); agora só lê `id, account_id, site_id, contact_id, session_id` e atualiza `fields` (anonimização). A matriz de permissões testa que `select *` falha.

### D58. A central só atualiza colunas específicas de envios e identidades
`update` por coluna em `submissions (contact_id, fields)` e `contact_identities (contact_id)`, mais `delete` em identidades. `receipt_status` continua fora do alcance da central no banco: "destino confirmado" só nasce do webhook (reforça D33). Defeito encontrado e corrigido no nível do grant: a mesclagem de conflitos da Fase 4 fazia `update` sem ter o grant e falhava.

### D59. Política de retenção por site, decidida pelo proprietário
`manual` (padrão; nada expira) ou `dias` (30 a 3650, contados do último contato real). O banco recusa `dias` sem prazo. A varredura roda no worker de hora em hora, junto da retenção de eventos, uma transação por contato, idempotente; sites arquivados continuam sob a política. A tela diz que depende do worker em execução.

### D60. Toda tabela do schema `public` tem RLS forçada
`worker_heartbeats` passou a ter RLS ativa e forçada com políticas permissivas, para a invariante ser verdadeira e testada sem exceções além de `schema_migrations`.

### D61. A auditoria de permissões é uma matriz declarada no teste
`tests/integration/permissoes.spec.ts` declara tabela × papel × privilégio, colunas, sequências, schemas, funções `SECURITY DEFINER`, RLS e política para todo grant. Qualquer grant novo não declarado reprova; a frente que o introduzir precisa escrevê-lo no teste.

### D62. Confirmação de exclusão sem JavaScript
"Excluir" abre um `<details>` com a explicação e o botão final "Excluir (anonimiza)". Retorno por querystring (`?aviso=`) com valores de uma lista fechada; validação sempre no servidor.

### D63. Limite documentado da anonimização
Envios de outro contato que, num conflito, carreguem o mesmo telefone ou e-mail não são tocados (são dados do outro contato até o operador decidir). Envios de diagnóstico (sem contato) também não; a central nunca os lista.

### Operação

### D64. Backup lógico, ponto no tempo
`pg_dump -Fc`, um arquivo por execução, carimbo UTC no nome, sufixo em vez de sobrescrita. PITR fica a cargo do provedor gerenciado como camada adicional, não substituta.

### D65. A restauração nunca vai para o banco de origem
O script recusa `--para` igual ao database de `DATABASE_URL_ADMIN` e bancos de sistema; recusa banco alvo não vazio sem `--forcar`. Promover um banco restaurado é trocar as URLs da aplicação, nunca sobrescrever o banco em uso.

### D66. Restaurar preserva políticas e grants
`pg_restore --no-owner --exit-on-error --single-transaction`, sem `--no-privileges`: políticas RLS e concessões fazem parte do contrato. Papéis são objetos do cluster e não vêm no dump; os que faltarem são criados `NOLOGIN` e recebem senha por `db:setup`.

### D67. Verificação distingue estrutura de contagem
Divergência estrutural (tabelas, versões de migração, políticas por nome, comando, papéis e expressão, RLS forçada, concessões, funções, índices, restrições) é falha com código de saída 1. Contagem diferente é aviso, porque a origem pode estar viva; o teste automático, em banco parado, exige as duas iguais.

### D68. Política sugerida de backup
Diário e antes de cada migração; retenção de 30 dias; armazenamento externo cifrado e de acesso restrito (o dump contém dados pessoais e hashes de senha); teste de restauração mensal registrado em `docs/BACKUP.md`. A primeira restauração real foi demonstrada em 20/10/2026 no ambiente local e está documentada lá.

### D69. Senha nunca em argumento de linha de comando
Vai por `PGPASSWORD`; `sslmode` da URL vira `PGSSLMODE`; `PG_BIN` aponta os binários quando não estão no PATH.

### D70. Limites de rede registrados
O `fetch` do Node usado pelo worker não lê `HTTP(S)_PROXY`: ambiente com proxy obrigatório precisa de liberação direta para a API do PageSpeed e para o provedor de e-mail. HSTS com `includeSubDomains` exige publicar a central num domínio cujos subdomínios tenham HTTPS, ou num subdomínio dedicado.

### D71. Guia de instalação copia os trechos da aba
`docs/INSTALACAO-NO-SITE.md` reproduz os trechos exatos da aba Instalação e de `public/c.v1.js`, sem inventar atributos; documenta `window.jw('consent', false)` como retirada de consentimento, comportamento que já existia no coletor.

### D72. Idempotência do envio de e-mail
Cada entrega manda `deliveryId` ao adaptador (header `idempotency-key` no Resend; campo no webhook). Se o e-mail saiu mas o `update ... 'enviado'` falha, há uma segunda tentativa; mesmo assim a janela residual existe (at-least-once) e fica documentada.

### D73. Filtros do outbox no SQL
Tipo fora da lista, site desligado e site arquivado são filtrados na consulta, não só em TypeScript, para que alertas que nunca serão publicados não ocupem o `limit 200` e travem a fila.

### D74. Tipos oferecidos nas preferências
`TIPOS_OFERECIDOS` omite `verificacao_atrasada` (o worker o grava já resolvido, D20): não se oferece o que nunca sairá. Contagens de pendentes/falhas na tela são por conta (`comConta`), não o total global do heartbeat.

### D75. Retenção de sessões e mesclagem de contatos
A retenção apaga também sessões com mais de 90 dias sem eventos nem envios (o worker ganhou `delete` em `sessions`). Ao mesclar "mesma pessoa", o nome de B passa para A (se A não tiver) e B fica anonimizado (`deletion_reason = 'mesclado'`); exclusão por retenção reavalia o prazo dentro da transação, e a recepção não reaproveita contato anonimizado na corrida.

### D76. Relatório: incidentes e fuso
Incidentes do período vêm de `incidentesNoIntervalo` (recorte no SQL, até 500), não dos 200 mais recentes; o fuso de referência do relatório do cliente é estável (ordem por nome). Velocidade mostra medições existentes mesmo sem chave configurada, com aviso.

### D77. Revisão adversarial da Fase 5 foi parcial
Os agentes de revisão caíram por limite de gasto; os achados de privilégios, outbox, retenção e relatórios foram verificados e corrigidos manualmente. Operação e interface não tiveram revisão adversarial independente. Pendente: `verificar-restauracao.ts` não compara grants por coluna.

### D78. Regressão de PageSpeed: confirmada, uma por episódio
O alerta `regressao_pagespeed` só abre quando as DUAS medições ok mais recentes da mesma URL e dispositivo estão ≥10 pontos abaixo da medição de referência que veio antes delas; uma queda isolada continua só "possível regressão" (D-anterior). A chave de deduplicação inclui a referência, então um episódio gera um alerta; ele é resolvido pelo worker quando a nota volta a menos de 10 pontos da referência. Contas existentes não ganham o novo tipo na lista de e-mail sozinhas (é escolha delas); contas novas já o têm.

### D79. Recuperação de senha: só com provedor real
A tela só oferece o formulário quando há provedor de e-mail que entrega (não `log`) e `APP_URL`; senão diz o motivo e manda falar com quem administra. Token de 32 bytes aleatórios, só o SHA-256 no banco, validade de 60 min, uso único, no máximo 3 pedidos por hora por usuário; a resposta é a mesma exista ou não a conta e o envio roda fora do caminho da resposta. Concluir a recuperação encerra TODAS as sessões. A tabela é inacessível ao `app_web`: tudo passa por funções SECURITY DEFINER. Sem teste ao vivo com provedor real (depende de credencial).

### D80. Importação da V1 é só cadastro
Clientes, sites e até 3 URLs prioritárias por site, a partir de um JSON exportado pelo operador; simulação por padrão, aplicação transacional e idempotente. Eventos, leads e medições da V1 NÃO entram (modelos de medição diferentes). A V1 nunca é acessada pelo script. Ver `docs/IMPORTAR-V1.md`.

### D81. Restauração compara grants por coluna
`verificar-restauracao.ts` passou a incluir `attacl` das colunas nas concessões a `app_*`.

### D82. Cliques por botão: contatos contados por clique, sem join
`botoes()` contava com `count(*)` sobre um `left join` entre cliques e submissões; N submissões atribuídas ao mesmo clique multiplicavam o clique. Agora os contatos são contados por subconsulta correlacionada na linha do clique e o resultado só agrega essas linhas. Consumidores (aba Botões, relatório, exportação CSV) usam a mesma função.

### D83. Recepção de formulário serializada por travas de aviso (advisory locks)
Dentro da transação da recepção, antes de qualquer leitura: trava por `(site, submission_id)` e, depois, travas por identidade (e-mail e telefone normalizados) em ordem alfabética, todas `pg_advisory_xact_lock`. Resolve a criação de contatos excedentes (mesma identidade em duas transações) e o contato excedente de reenvios simultâneos, sem depender de nível de isolamento mais alto nem de reescrever o modelo. A ordem fixa evita deadlock; diagnóstico não pega travas de identidade. Isolamento por conta/site, anonimização e conflitos entre identidades ficam como estavam.

### D84. Ciclo de vida do submission_id no coletor (parcialmente substituída por D86)
`session_key` é sobrescrito a cada envio com a sessão vigente. `submission_id` vazio é gerado e marcado (`data-jw-auto`); fica **mantido** enquanto o resultado for incerto (a nova tentativa não duplica) e só é descartado quando o envio termina: `form.reset()` ou `window.jw('submitted', '<nome>')`. Valor posto pelo site nunca é tocado. Sem aviso de fim, o próximo envio de um formulário AJAX na mesma página é descartado como duplicado — documentado em `docs/INSTALACAO-NO-SITE.md`, que também diz como atualizar.

### D85. Worker com laços independentes
`worker/agendador.ts`: disponibilidade, PageSpeed, e-mail, heartbeat e retenção rodam cada uma no seu laço e no seu intervalo; mesma tarefa nunca se sobrepõe; erro é tratado por tarefa; `parar()` espera execuções em andamento e acorda quem dorme. O pool passou a ter `CONCORRENCIA + CONCORRENCIA_PAGESPEED + 4` conexões. Timeouts e tolerâncias não foram alterados. Heartbeat reporta `fase: 6` e versão `v2-fase6`.

### D86. Reset visual não confirma recebimento (substitui o ciclo de D84)
O coletor deixou de escutar `reset`: `form.reset()`, timeout, erro e resposta incerta mantêm o `submission_id` gerado (a retentativa não duplica). A única forma de encerrar a tentativa é a confirmação explícita `window.jw('submitted', '<nome>' | form)`, chamada pela integração depois de resposta de sucesso. Identificador posto pelo site continua intocado. D84 vale para `session_key` e para o resto do ciclo. Teste: `tests/e2e/coletor-formulario.spec.ts` (o cenário "reset antes da resposta" falhava com o coletor anterior).

### D87. Rollback só para versões verificadas
"Migração aditiva" deixou de ser dada como garantia de retorno: migrações alteram permissões e restrições (0008, 0009). `docs/COMPATIBILIDADE.md` registra, por execução da suíte do commit antigo contra o schema atual em banco separado, quais versões são compatíveis. Hoje: `68042a1` (206/206) e `c30a982` (193/196, as 3 falhas são a matriz de permissões antiga); o código atual sobre schema sem 0009/0010 falha (6 testes) e não é suportado. Qualquer outra versão: não validada.

