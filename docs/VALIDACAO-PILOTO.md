# Validação em site piloto

**Estado: PENDENTE.** Nada abaixo foi executado contra serviços reais. Os testes automatizados (com bancos de teste, `fetch` e provedores simulados) provam as regras, mas **não substituem** esta validação: ela é a única que exercita PageSpeed, provedor de e-mail e rede de verdade. Preencha as evidências ao executar e troque o estado para EXECUTADA (com data e responsável) somente quando todos os itens passarem.

Portal do cliente e funcionalidades novas ficam para depois desta validação.

## 1. Variáveis (nomes, nunca valores)

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_WORKER`, `DATABASE_URL_INGEST`, `DATABASE_URL_FORMS`, `DATABASE_URL_ADMIN` | central e worker | papéis do banco (veja `.env.example`) |
| `SESSION_SECRET` | central | sessões |
| `APP_URL` | central **e** worker | endereço público `https://…` da central; usado nos links de e-mail e na recuperação de senha |
| `PAGESPEED_API_KEY` | worker | medição real (Google PageSpeed Insights API v5) |
| `PAGESPEED_CONCORRENCIA` | worker (opcional) | padrão 2 |
| `EMAIL_PROVIDER` (`resend`, `postmark` ou `webhook`; **não** `log`) | central e worker | entrega real |
| `EMAIL_FROM`, `EMAIL_API_KEY` ou `EMAIL_WEBHOOK_URL` | central e worker | conforme o provedor |
| `MONITOR_EXCECOES_DE_REDE` | worker | **deixe vazio** no piloto |

Guarde segredos no cofre da hospedagem, nunca no repositório nem em chat.

## 2. Conectividade

- Worker → site piloto (HTTPS 443) para a checagem de disponibilidade.
- Worker → `https://www.googleapis.com` (PageSpeed) e → o provedor de e-mail. O `fetch` do Node não usa `HTTP(S)_PROXY`: ambiente com proxy obrigatório precisa de liberação direta.
- Navegador do visitante → `APP_URL` (coletor `/c.v1.js`, `/api/collect`, `/api/forms/<publicId>`). O site piloto precisa alcançar a central publicada.
- Central → banco com TLS; a central precisa abrir em HTTPS (HSTS está ativo em produção).
- Uma caixa de entrada real para receber o alerta.

## 3. Procedimento

### 3.1 Preparação
1. Publicar central e worker (`docs/IMPLANTACAO.md`), com `npm run db:migrate` aplicado até a última migração.
2. Cadastrar cliente e site piloto na central (ou usar `docs/IMPORTAR-V1.md`).
3. Em Configurações → Notificações, ligar o e-mail para a caixa de teste (o estado do provedor deve aparecer como ativo na aplicação **e** no worker).

### 3.2 Disponibilidade
1. Ligar o monitor do site. **Esperado:** em até um intervalo, aba Disponibilidade com última checagem real, TLS lido e estado "Online".
2. Provocar uma indisponibilidade controlada (manutenção do próprio piloto, ou apontar temporariamente um monitor para uma URL que responda 5xx). **Esperado:** incidente só após as falhas consecutivas configuradas; alerta em Atenção.
3. Restaurar. **Esperado:** incidente recuperado com duração observada.
4. Em Configurações, o heartbeat do worker deve estar recente (< 1 min) **durante** uma medição de PageSpeed em andamento.

### 3.3 PageSpeed real
1. Em Velocidade, cadastrar até 3 URLs do domínio e acionar "Medir agora".
2. **Esperado:** notas de laboratório (performance, acessibilidade, boas práticas, SEO), LCP/CLS/TBT; dados de campo (CrUX) só se o Google tiver amostra, com o escopo (URL ou origem) indicado. Resposta sem campo aparece como "insuficiente", nunca como zero.
3. Conferir a nota contra a do PageSpeed Insights no site do Google (a variação de alguns pontos é normal).
4. Chave inválida/cota esgotada deve aparecer como estado próprio (não como nota).

### 3.4 E-mail real
1. Disparar um alerta (ex.: o incidente do passo 3.2).
2. **Esperado:** um e-mail por destinatário na caixa real, com assunto, o que aconteceu, horário no fuso do site e link para a central; entrega "enviado" em Configurações com o id do provedor.
3. Conferir que **não** chegaram duplicatas depois de alguns minutos.
4. Opcional: pedir recuperação de senha e confirmar o e-mail com o link de 60 minutos.

### 3.5 Percurso visita → clique → formulário → contato → relatório
1. Na aba Instalação, copiar a tag do coletor para o site piloto (sem `?jw_test`). Marcar um botão com `data-track-id` e o formulário com `data-track-form` (modo escolhido na aba).
2. Abrir o site em janela normal: visita. Clicar no botão. Enviar o formulário com um e-mail de teste. Se o formulário for AJAX e ficar na página, confirmar que o fim do envio é avisado (`form.reset()` ou `jw('submitted', …)`) e que um segundo envio gera **outro** contato/submissão.
3. **Esperado:** em Botões, 1 clique e 1 contato atribuído (atribuição "último clique"); em Contatos, o contato com a origem do evento; em Resumo, a visita. Nenhum desses números muda com o modo diagnóstico.
4. Em Relatórios, gerar o relatório do site para o período e comparar com as abas (mesmos números). Imprimir/salvar em PDF e conferir cortes de página.

## 4. Registro de evidências

| Item | Data | Quem | Resultado (OK / falhou / bloqueado) | Evidência (captura, id do provedor, link) |
|---|---|---|---|---|
| Disponibilidade: checagem real | | | PENDENTE | |
| Incidente e recuperação | | | PENDENTE | |
| Heartbeat durante PageSpeed | | | PENDENTE | |
| PageSpeed real (laboratório) | | | PENDENTE | |
| CrUX (campo) ou "insuficiente" | | | PENDENTE | |
| E-mail recebido, sem duplicata | | | PENDENTE | |
| Recuperação de senha por e-mail | | | PENDENTE | |
| Clique atribuído | | | PENDENTE | |
| Formulário → contato | | | PENDENTE | |
| Segundo envio AJAX → novo contato/submissão | | | PENDENTE | |
| Relatório = abas | | | PENDENTE | |

Qualquer divergência vira defeito registrado em `docs/DECISOES.md` antes de se declarar o piloto concluído.
