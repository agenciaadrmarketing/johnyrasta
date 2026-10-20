# Roteiro para colocar a versão no ar (piloto)

Versão: commit `e39cb70e63d1df3b422ab15eeaa05a2162463fb2` (as quatro correções de estabilização; é o commit da verificação final). Complementa `docs/IMPLANTACAO.md`, `docs/BACKUP.md`, `docs/INSTALACAO-NO-SITE.md` e `docs/VALIDACAO-PILOTO.md`. Nada aqui altera sites de clientes: o snippet só é instalado no site piloto, por quem tem autorização sobre ele.

O repositório **não traz** Dockerfile, CI de deploy nem configuração de plataforma (`vercel.json`, `render.yaml` etc.). O roteiro abaixo é por processo, independente de hospedagem.

## 1. Onde executar cada peça

| Peça | Requisito | Comando | Observações |
|---|---|---|---|
| **Web (Next.js)** | Node 20+ (testado com 22), HTTPS na frente | `npm ci && npm run build`, depois `npm start` | Proxy reverso repassando `Host`, `Origin` e `X-Forwarded-For`. Serve também `/c.v1.js`, `/api/collect` e `/api/forms/*` para os sites. |
| **Worker** | **Processo contínuo** (VPS, container ou "background worker"); nunca função que dorme | `npm run worker` | Supervisor com restart (exemplo systemd em `IMPLANTACAO.md`). Para com `SIGTERM`: espera as execuções em andamento antes de fechar o pool. |
| **PostgreSQL** | 14+ (testado com 16), TLS fora de localhost | — | Gerenciado ou próprio; backups automáticos do provedor ligados. |
| **Máquina de operação** | Node + `pg_dump`/`pg_restore` ≥ versão do servidor | `npm run db:*` | Única que recebe `DATABASE_URL_ADMIN`. Pode ser seu computador. |

Web e worker podem ficar no mesmo servidor, como dois serviços separados. Banco separado.

## 2. Variáveis por processo (nomes; valores só no gestor de segredos)

**Web**
- Obrigatórias: `DATABASE_URL` (app_web), `DATABASE_URL_INGEST` (app_ingest), `DATABASE_URL_FORMS` (app_forms), `APP_URL` (`https://…`, sem barra final), `NODE_ENV=production`.
- Opcionais: `DATABASE_SSL_CA`, `PAGESPEED_API_KEY` (só para a tela mostrar "configurado"; a medição é do worker), `EMAIL_PROVIDER` + `EMAIL_FROM` + `EMAIL_API_KEY` ou `EMAIL_WEBHOOK_URL` (a **recuperação de senha** envia a partir da web, então o provedor precisa estar na web também), `CSP_RELATORIO`.
- `SESSION_SECRET`: o código atual **não a lê** (sessões são opacas, guardadas no banco). `IMPLANTACAO.md` e `.env.example` ainda a listam; definir não faz mal, omitir também não.

**Worker**
- Obrigatória: `DATABASE_URL_WORKER` (app_worker).
- Recomendadas: `NODE_ENV=production`, `APP_URL` (links dos e-mails; sem ele a mensagem leva só o caminho), `WORKER_ID`.
- Opcionais: `PAGESPEED_API_KEY` (**sem ela nenhuma medição é agendada**), `PAGESPEED_CONCORRENCIA` (2), `MONITOR_CONCORRENCIA` (5), `EMAIL_PROVIDER` + `EMAIL_FROM` + `EMAIL_API_KEY`/`EMAIL_WEBHOOK_URL` (**sem provedor nenhum alerta sai por e-mail**), `DATABASE_SSL_CA`.
- `MONITOR_EXCECOES_DE_REDE`: **vazia**.

**Máquina de operação (scripts)**
- `DATABASE_URL_ADMIN` e as quatro `DATABASE_URL*` dos papéis (o `db:setup` usa as senhas que estão nelas); `BOOTSTRAP_ACCOUNT/NAME/EMAIL/PASSWORD` só no `db:bootstrap` (apague depois); `BACKUP_DIR`, `PG_BIN` opcionais.
- Nunca: `DEMO_MODE`, `db:demo`, `db:setup -- --drop`.

Quem define cada senha e chave é você, direto no gestor de segredos da hospedagem. Não as envie por chat.

## 3. Banco, migrações, administrador e saúde do worker

```bash
# na máquina de operação, com as URLs no ambiente
npm ci
npm run db:setup        # cria banco (se faltar), papéis com as senhas das URLs, aplica migrations/ (0001…0010)
npm run db:migrate      # em atualizações: ver seção 7 — ele NÃO faz backup sozinho
BOOTSTRAP_ACCOUNT="…" BOOTSTRAP_NAME="…" BOOTSTRAP_EMAIL="…" BOOTSTRAP_PASSWORD="…" npm run db:bootstrap
```
Depois do bootstrap, remova as variáveis `BOOTSTRAP_*` do ambiente.

Verificação do worker, nesta ordem:
1. Log do worker ao subir: `iniciado`, a linha do PageSpeed (configurado ou "NÃO configurado") e a do e-mail (provedor ou "desativado").
2. Central → Configurações: "Banco: conectado como app_web"; "Worker: ativo · visto há poucos segundos" com o `WORKER_ID` esperado; versão `v2-fase6`. Cinco minutos sem sinal viram "sem sinal".
3. Cadastre o site piloto, ligue o monitor: em segundos deve haver "Última checagem" real na aba Disponibilidade.
4. Painel de e-mail em Configurações: o provedor aparece ativo **na aplicação e no worker**; divergência é avisada na tela.

## 4. PageSpeed, e-mail e APP_URL

- **APP_URL**: o endereço público final, HTTPS, sem barra. Entra nos snippets, nos links de e-mail, no link de recuperação de senha e na checagem de origem das mutações. Se mudar, o snippet instalado no site continua apontando para o endereço antigo.
- **PageSpeed**: crie a chave da API PageSpeed Insights no console do Google, restrinja-a a essa API e defina `PAGESPEED_API_KEY` no worker (e na web, se quiser o estado na tela). Reinicie o worker. Na aba Velocidade cadastre até 3 URLs do domínio e use "Medir agora" (há intervalo mínimo entre pedidos). Chave ausente aparece como "não configurado"; cota esgotada como estado próprio; nunca como nota.
- **E-mail**: escolha `resend`, `postmark` ou `webhook`; defina `EMAIL_PROVIDER`, `EMAIL_FROM` (domínio verificado no provedor), `EMAIL_API_KEY` (ou `EMAIL_WEBHOOK_URL`) no **worker e na web**. `log` não entrega nada e a recuperação de senha o recusa. Em Configurações → Notificações: ligue o e-mail, informe a caixa de teste e deixe marcados os tipos. Só alertas criados **depois** de salvar as preferências são enviados (não há despejo de histórico).

## 5. Snippet no site piloto e integração do formulário

Fonte de verdade: aba **Instalação** do site (ela já embute `APP_URL` e o `publicId`). Forma geral:

```html
<script src="https://CENTRAL/c.v1.js" data-site="PUBLIC_ID" defer></script>
```
- Botões: `data-track-id="nome"` (+ opcional `data-track-pos`, `data-track-kind`); WhatsApp, `tel:` e `mailto:` são detectados sozinhos.
- Formulário: `data-track-form="contato"` no `<form>`, com dois campos ocultos vazios: `submission_id` e `session_key`. O coletor preenche os dois no envio.
- Escolha **um** modo de destino na aba (endpoint da central, webhook assinado ou cópia auxiliar). Só o webhook assinado produz "destino confirmado".
- Consentimento: `data-consent="exigido"` + `window.jw('consent')` quando o visitante aceitar.

**Formulário AJAX que permanece na página** — avise o fim do envio, depois da resposta do servidor:
```js
const r = await fetch(destino, { method: 'POST', body: dados });
if (r.ok) {
  form.reset();                         // ou: window.jw('submitted', 'contato')
}                                       // erro de rede / timeout / resposta incerta: NÃO chame
```
Com `data-track-form="contato"`, `form.reset()` e `jw('submitted','contato')` equivalem.

### Conferência do ciclo de `submission_id` (feita sobre o código e os testes)
- **Timeout ou resultado incerto — preserva.** O identificador é gerado uma vez (marcado em `data-jw-auto`) e só sai quando alguém declara o fim do envio. Reenviar sem `reset()`/`submitted` usa o **mesmo** id, e o servidor devolve `duplicated: true` se o primeiro tiver chegado. Coberto por `tests/e2e/coletor-formulario.spec.ts` (cenário B) e, no servidor, por `estabilizacao.spec.ts` (cenário B, concorrente).
- **Valor posto pelo seu site — intocado.** Nem regenerado nem descartado (cenário B2).
- **`form.reset()` antes da confirmação — NÃO preserva, por desenho.** O coletor trata `reset` como "o envio terminou": ele limpa o id gerado, e o próximo envio ganha outro. Se a integração chamar `reset()` de forma otimista (antes da resposta) e depois repetir a tentativa porque a resposta falhou, o reenvio sai com **outro** `submission_id` e, se o primeiro envio tinha chegado, o contato é registrado duas vezes. Regra para a integração do piloto: **só chame `form.reset()`/`jw('submitted')` depois de uma resposta de sucesso** (ou recusa definitiva, como 4xx). Não resete o formulário ao clicar em enviar, nem em `finally`.
- Limitação aceita: `reset()` chamado pelo botão "Limpar" do próprio visitante também conclui o ciclo. Se o envio estava incerto e a pessoa limpa e preenche de novo, é outro envio mesmo.
- Se a integração do piloto não conseguir garantir "reset só depois do sucesso", a alternativa segura é o site gerar o próprio `submission_id` (um por tentativa lógica) e preenchê-lo antes de enviar; o coletor então não toca nele.
- `session_key`: sempre regravado com a sessão vigente no envio; após 30 minutos de inatividade é uma sessão nova (cenário C).

## 6. Percurso completo e registro das evidências

Execute `docs/VALIDACAO-PILOTO.md` §3.2 a §3.5 (disponibilidade, PageSpeed, e-mail, visita → clique → formulário → contato → relatório). Em cada linha da tabela §4: data, quem executou, resultado e evidência (captura da tela, id da mensagem do provedor, link do relatório). Marque o piloto como EXECUTADA só com todas as linhas OK. Falha ou divergência vira registro em `docs/DECISOES.md` antes de seguir. Nunca cole segredos nas evidências.

## 7. Backup antes de implantar e retorno à versão anterior

Antes de **qualquer** `db:migrate` ou troca de versão:
```bash
npm run db:backup                                  # → backups/johnyweb-<UTC>.dump
npm run db:restaurar -- --para johnyweb_verificacao   # prova que o arquivo restaura (apague o banco depois)
```
Guarde o `.dump` fora do servidor (contém dados pessoais e hashes de senha). **`db:migrate` não faz backup sozinho**, ao contrário do que `IMPLANTACAO.md` e `BACKUP.md` dão a entender: rode o backup antes, à mão. Anote o commit em produção (`git rev-parse HEAD`) e a última versão em `schema_migrations`.

Falha na implantação:
1. **Código**: volte web e worker juntos para o commit anterior (`git checkout <sha-anterior>`, `npm ci`, `npm run build`, reinicie os dois). As migrações são aditivas; a versão anterior roda sobre o schema novo.
2. **Migração que falhou**: cada arquivo roda em transação; falhou = nada aplicado. Corrija e repita.
3. **Dado comprometido**: restaure o backup **num banco novo** (`npm run db:restaurar -- --para johnyweb_AAAAMMDD`), rode `db:setup` para reaplicar as senhas dos papéis, confira a verificação estrutural e só então troque as quatro URLs da aplicação. O banco original não é sobrescrito.
4. Antes de apagar o banco antigo, confirme com o operador e mantenha o backup.

## 8. Informações de infraestrutura que ainda faltam

Nada disso consta no repositório; preciso saber (ou você decide):
1. Hospedagem escolhida para web, worker e PostgreSQL (e se web e worker dividem o servidor).
2. Domínio e endereço final da central (`APP_URL`) e se o domínio tem subdomínios sem HTTPS (afeta o HSTS com `includeSubDomains`).
3. Provedor de e-mail escolhido e o domínio remetente verificado.
4. Quem cria a chave do PageSpeed e onde os segredos ficam guardados.
5. O site piloto (domínio), quem tem acesso para instalar o snippet e como o formulário atual envia (post comum, AJAX/fetch, plugin de formulário).
6. Onde ficarão os backups externos e quem agenda o `db:backup` diário.
7. Qual monitor externo vigiará a própria central.
