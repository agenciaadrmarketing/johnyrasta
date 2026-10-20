# Instalar o coletor e os formulários num site de cliente

Guia para quem publica o site. Tudo o que está aqui também aparece, já preenchido com o identificador do site, na aba **Instalação** do espaço do site na central — prefira copiar de lá. Este documento explica o que cada trecho faz e o que não faz.

Antes de começar:
- O site precisa estar cadastrado na central (domínio normalizado: `www.` é o mesmo site; outro subdomínio é outro site).
- A central precisa estar publicada com `APP_URL` igual ao domínio público dela: os trechos abaixo usam `https://central.suaagencia.com.br` como exemplo; o seu vem da aba Instalação. Um snippet apontando para `localhost` é o erro mais comum.
- `data-site` leva o **identificador público** do site. Não é credencial: só diz "este evento é deste site". Quem valida é o servidor.

## 1. Instalar o coletor (`/c.v1.js`)

Um arquivo ES5 de ~4 KB, versionado no nome (`c.v1.js`), servido pela própria central com cache de 5 minutos. Carregue com `defer`; ele não bloqueia a página. Se a tag for incluída duas vezes, a segunda é ignorada (`window.__jw` já marcado).

### HTML, Framer, Webflow, Wix
Cole antes de `</body>` ou no campo de "código personalizado" de rodapé do construtor (Framer: configurações do site → código personalizado → fim do `<body>`; Webflow: configurações do projeto → custom code → footer; Wix: configurações → código personalizado → fim do body — os nomes variam com a versão da ferramenta):

```html
<script src="https://central.suaagencia.com.br/c.v1.js" data-site="SEU_PUBLIC_ID" defer></script>
```

Com consentimento exigido (ver seção 4), a aba Instalação já gera a tag com `data-consent="exigido"`:

```html
<script src="https://central.suaagencia.com.br/c.v1.js" data-site="SEU_PUBLIC_ID" data-consent="exigido" defer></script>
```

### React / Next.js
```tsx
// app/layout.tsx (Next) — ou a tag <script> acima em index.html (Vite/CRA)
<Script src="https://central.suaagencia.com.br/c.v1.js" data-site="SEU_PUBLIC_ID" strategy="afterInteractive" />
// Rotas SPA são detectadas automaticamente (pushState/replaceState/popstate): cada troca de rota vira uma visita.
```
Em React puro, uma tag `<script … defer>` em `index.html` basta. Não é preciso chamar nada a cada rota.

### WordPress
No `functions.php` do tema filho, ou num plugin de "cabeçalho e rodapé" (cole a tag HTML no campo do rodapé):
```php
add_action('wp_footer', function () {
  echo '<script src="https://central.suaagencia.com.br/c.v1.js" data-site="SEU_PUBLIC_ID" defer></script>';
});
```

### Se o site do cliente tiver CSP própria
Libere a origem da central em `script-src` (carregar `c.v1.js`) e em `connect-src` (o coletor envia para `APP_URL/api/collect` por `sendBeacon`/`fetch`). Sem isso o navegador bloqueia silenciosamente e a aba Instalação fica em "nenhum evento real recebido ainda".

## 2. Marcar botões

O coletor registra cliques de duas formas:

- **Marcados** por `data-track-id` — recomendado para tudo o que importa. É o contrato estável (o mesmo da V1): o nome que você escolher é o que aparece na aba Botões e horários.
- **Detectados automaticamente**: links para WhatsApp (`wa.me`, `api.whatsapp.com`, `web.whatsapp.com`, `whatsapp:`), telefone (`tel:`) e e-mail (`mailto:`) sem `data-track-id` entram como `auto-whatsapp`, `auto-phone`, `auto-email`, marcados como detecção automática.

```html
<a href="https://wa.me/55…" data-track-id="whatsapp-topo" data-track-pos="hero">Falar no WhatsApp</a>
<button data-track-id="orcamento" data-track-kind="form" data-track-pos="rodape">Pedir orçamento</button>
<!-- Links wa.me, tel: e mailto: sem data-track-id são identificados automaticamente e marcados como tal. -->
```

| Atributo | Para quê | Valores |
|---|---|---|
| `data-track-id` | nome estável do botão; é a chave das comparações entre botões e da atribuição de contatos | texto curto, sem dado pessoal (até 100 caracteres) |
| `data-track-pos` | onde o botão está (comparar o mesmo botão em posições diferentes) | livre, ex. `hero`, `rodape`, `menu` (até 50) |
| `data-track-kind` | o tipo da ação quando não dá para deduzir do `href` | `whatsapp`, `phone`, `email`, `form`, `outro`. Sem ele, o coletor deduz do `href`; sem `href` reconhecível, fica `outro` |

Detalhes que evitam surpresa:
- O clique é procurado do elemento clicado para cima, até 8 níveis: pode marcar o `<a>` e deixar o ícone dentro sem atributo.
- O texto do botão (até 80 caracteres) é enviado para ajudar a reconhecer na central. Não ponha dado pessoal em texto de botão.
- O mesmo `data-track-id` em dois lugares vira um botão só nas contagens — use `data-track-pos` para separar.
- Ação disparada por JavaScript (sem clique num elemento marcado): `window.jw('click', 'nome-do-botao')` registra um clique do tipo `outro`.
- Mudar o `data-track-id` depois de publicado começa uma série nova; o histórico do nome antigo fica com o nome antigo.

## 3. Formulários — três modos, e só um prova entrega

Escolha o modo na aba Instalação (passo 1, "Formulários"). A central mostra, ao lado de cada contato, de onde veio a evidência. Campos aceitos por padrão: `name`, `email`, `phone` (ativáveis: `company`, `subject`, `message`); tudo o mais é descartado no servidor. É preciso ao menos **um** e-mail ou telefone válido; o nome é opcional. Telefone sem DDI recebe o país padrão do site.

Em todos os modos, ponha `data-track-form="<nome>"` no `<form>`: é isso que faz o coletor registrar a tentativa de envio (`form_attempt`) e preencher `session_key` e `submission_id` vazios no momento do envio — o `session_key` é o que permite atribuir o contato ao último clique da mesma sessão (até 30 minutos antes).

### Modo "endpoint da central" (o site posta direto aqui)
Sucesso só depois de persistido. Reenvio com o mesmo `submission_id` não duplica.

```html
<form method="post" action="https://central.suaagencia.com.br/api/forms/SEU_PUBLIC_ID" data-track-form="contato">
  <input type="hidden" name="submission_id" value="GERE-UM-ID-UNICO-POR-ENVIO">
  <input type="hidden" name="page_path" value="/contato">
  <input type="hidden" name="session_key" value="">  <!-- o coletor preenche no envio (atribuição); submission_id vazio também é preenchido -->
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">  <!-- honeypot -->
  <input name="name"> <input name="email" type="email"> <input name="phone">
  <button>Enviar</button>
</form>
```
Ou por `fetch` com JSON: `{ submission_id, fields: { name, email, phone }, page_path, session_key }`. Resposta: `{ ok: true, status: "recebido", duplicated: false, attribution: "ultimo_clique" | "sem_atribuicao" }`. O endpoint aceita `application/json` e `application/x-www-form-urlencoded`, tem CORS aberto, corpo até 32 KB e 30 envios por minuto por site e IP.

- `submission_id`: 8 a 128 caracteres de `A-Z a-z 0-9 _ . : -`. Gere um por envio (o coletor gera se o campo estiver vazio e o formulário tiver `data-track-form`).
- `website` é o **honeypot**: campo escondido que humanos não preenchem; preenchido, o envio é rejeitado.
- Um `<form method="post">` sem JavaScript navega para a resposta JSON da central. Para manter o visitante no site, envie por `fetch` e mostre a mensagem de sucesso só quando `ok` for `true`.

### Modo "destino original confirma por assinatura" (webhook)
O site continua enviando para o CRM/automação de sempre; **esse sistema** confirma para a central, servidor a servidor. É o único caminho que produz "destino confirmado". Gere o segredo na aba Instalação (mostrado uma única vez, por 10 minutos; "Trocar segredo" invalida o anterior).

```
POST https://central.suaagencia.com.br/api/forms/SEU_PUBLIC_ID/confirmar
Authorization: Bearer <segredo>
X-Johny-Timestamp: <epoch em segundos>
X-Johny-Nonce: <string única por envio>
X-Johny-Signature: HMAC_SHA256(segredo, timestamp + "." + nonce + "." + corpo)
Content-Type: application/json

{ "submission_id": "…", "fields": { "name": "…", "email": "…", "phone": "…" }, "page_path": "/contato", "session_key": "…" }
// Janela de 5 min; nonce repetido é recusado (replay).
```
Para a atribuição funcionar, o site precisa repassar ao CRM o `session_key` (lido com `window.jw('session')`) e o `submission_id`, e o CRM precisa devolvê-los na confirmação. Sem isso o contato chega "sem atribuição" — correto, não inventado.

### Modo "cópia auxiliar da tentativa"
O site envia uma cópia do que tentou enviar ao destino original. Registra "contato recebido", **nunca** prova que o destino aceitou. Se o site souber que o destino falhou, informe `destination_status: "failed"` e o envio fica "falha no destino".

```js
fetch("https://central.suaagencia.com.br/api/forms/SEU_PUBLIC_ID?mode=auxiliar", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ submission_id, fields: { name, email, phone }, page_path: location.pathname, session_key: window.jw('session'), destination_status: "unknown" })
});
```

### Modo "não receber formulários"
Envios são recusados (403) e nada é guardado. O coletor continua medindo visitas e cliques.

### Opção: não guardar a mensagem
Por padrão o conteúdo de `message` **não** é guardado, mesmo que o campo exista. Ative em Instalação só quando houver finalidade clara; evite em saúde e advocacia.

## 4. Consentimento

Dois modos, escolhidos na aba Instalação:

- **"Identificador do navegador desde o início"** (padrão): o coletor guarda um identificador aleatório em `localStorage` (`jw_v`) para distinguir visitantes recorrentes. Sessão (`jw_s`, 30 min) fica em `sessionStorage`.
- **"Só após o site chamar `jw('consent')`"**: a tag ganha `data-consent="exigido"`. Visitas e cliques continuam sendo medidos **sem** identificador persistente (`visitor_id` nulo) até o site avisar que o visitante aceitou analytics:

```js
// Quando o visitante aceitar analytics:
window.jw('consent');
// Para retirar (volta a medir sem identificador persistente):
window.jw('consent', false);
```
Chame a partir do seu banner de cookies. O identificador já gravado antes de uma recusa não é apagado pelo coletor; se a sua política exigir, remova `localStorage.jw_v` no mesmo gesto.

Receber um pedido de contato tem finalidade própria (o visitante está pedindo para ser contatado) e não depende do consentimento de analytics.

## 5. Testar a instalação

1. Na aba Instalação, **Iniciar teste** gera um token válido por 1 hora.
2. Abra o próprio site com `?jw_test=<token>` na URL (o coletor guarda o token na sessão da aba) ou a página de teste da central, `https://central.suaagencia.com.br/teste/SEU_PUBLIC_ID?jw_test=<token>`, que carrega o coletor real com botões típicos e um formulário.
3. Clique nos botões, envie o formulário, recarregue a aba Instalação: os selos **Visita**, **Clique** e **Formulário** confirmam cada evidência, com a lista dos eventos de teste.
4. Feche a aba de teste ao terminar — o token fica na `sessionStorage` dela.

Tudo o que o token tocar é marcado como diagnóstico: fora das contagens, sem criar contato, sem "primeiro contato real". Por isso o selo "Script medindo" só vira **Confirmado** quando chega o primeiro evento real, de um visitante comum.

Sem token, a página `/teste/<publicId>` avisa que os eventos contariam como reais. Use-a só pelo link da aba Instalação.

## 6. Migrando um site da V1

O coletor antigo era `/t.js`. **Remova a tag antiga antes** de instalar `c.v1.js` — inclusive dentro de um container de tag manager, de um plugin de rodapé ou de um tema. Dois coletores diferentes na mesma página dobram as requisições e podem gerar dois registros do mesmo clique (eles não compartilham a deduplicação).

Os atributos `data-track-id` e `data-track-pos` são os mesmos da V1: os botões já marcados continuam valendo. `data-track-kind` é novo e opcional. O endereço dos formulários mudou (`/api/forms/<publicId>`): formulários que postavam no endpoint antigo precisam ser apontados para o novo e ganhar `data-track-form`.

Confira a migração com o teste com token (seção 5) e, em 24 horas, com o selo "Script medindo" e a aba Botões e horários.

## 7. O que o coletor NÃO faz

- **Não lê campos de formulário.** No envio de um formulário com `data-track-form` ele registra só o gesto (`form_attempt`) e preenche `session_key`/`submission_id` vazios. Os dados do formulário chegam à central apenas pelo caminho que você escolher na seção 3 — ou não chegam.
- **Não captura teclas, senhas, cliques fora de botões marcados ou detectados, nem conteúdo da página.**
- **Não envia a query string nem o fragmento** da URL: só o caminho (`/contato`, nunca `/contato?email=…`). Exceções: apenas `utm_source`, `utm_medium` e `utm_campaign` são lidas da URL. O referrer é reduzido ao host no servidor.
- **Não grava IP.** O IP serve só para o limite de requisições, em memória, e não é persistido com eventos nem sessões.
- **Não usa cookies.** Usa `localStorage` (identificador do visitante, sujeito ao consentimento) e `sessionStorage` (sessão de 30 min e token de teste).
- **Não bloqueia a página**: `defer`, envio em lote (até 20 eventos por requisição, 800 ms depois do evento ou ao sair da página) por `sendBeacon`, com `fetch keepalive` como alternativa. Falha de rede descarta o lote silenciosamente — o site nunca quebra por causa da central.
- **Não afeta HTTP nem PageSpeed**: a disponibilidade é verificada pelo worker, de fora, e as medições de velocidade vêm da API do Google. A aba Instalação deixa isso explícito.

## 8. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "nenhum evento real recebido ainda" depois de horas | tag não publicada, `APP_URL` errado no snippet, CSP do site bloqueando, bloqueador de anúncios no navegador de teste | Veja o console do navegador: a tag carregou? `window.__jw` é `"v1"`? Repita com o teste com token |
| Eventos chegam, cliques não | botões sem `data-track-id` e sem `href` reconhecível | Marque os botões (seção 2) |
| Contato "sem atribuição" | formulário sem `data-track-form` ou `session_key` não repassado ao CRM (modo webhook) | Adicione o atributo; no webhook, repasse `session_key` |
| Envio devolve 403 | modo "não receber formulários" | Mude o modo na aba Instalação |
| Envio devolve 422 | nenhum e-mail/telefone válido, ou honeypot preenchido | Confira os campos; não preencha `website` por script |
| Envio devolve 429 | mais de 30 envios/min do mesmo IP para o site | Normal em teste automatizado; em produção, investigue |
| Site desconhecido (404) | site arquivado ou `data-site` errado | Reative o site ou copie o snippet de novo |
| Alteração no coletor não aparece | cache de 5 min de `c.v1.js` | Aguarde ou force recarga |
