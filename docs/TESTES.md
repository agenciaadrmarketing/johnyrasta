# Testes: o que roda e o que é ignorado

Comandos (todos a partir da raiz, com Postgres local e `.env.local`):

```bash
npx tsc --noEmit        # tipos
npm run lint            # ESLint, zero avisos
npm run design          # tokens: temas cobrem os mesmos tokens, nenhuma cor inventada
npx vitest run          # unidade + integração (banco real recriado por suíte)
npm run build           # build de produção
PW_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test   # e2e (next start na porta 3100)
```

`PW_EXECUTABLE` só é necessário onde o Chromium já vem instalado (como neste ambiente de desenvolvimento).

## Teste ignorado

Um teste do Playwright aparece como **ignorado (skipped)** em toda execução completa:

- **`tests/e2e/fase1.spec.ts` — "celular › sem rolagem horizontal em Meus sites, site e configurações; no máximo quatro destinos na barra inferior"**.
- Motivo: o teste só faz sentido num viewport de telefone (barra inferior e rolagem horizontal). Ele traz `test.skip(({ isMobile }) => !isMobile, 'só no projeto celular')`, então é ignorado no projeto `desktop` e **executado no projeto `celular`**. O "1 skipped" é a instância desktop; não é teste quebrado nem desligado, e nenhum comportamento deixa de ser verificado.

## O que os testes simulados não provam

Os testes usam banco de teste real (PostgreSQL com RLS, papéis e migrações reais), mas `fetch` do PageSpeed, provedores de e-mail e o site de destino são simulados. A integração com serviços reais está em `docs/VALIDACAO-PILOTO.md` e permanece **pendente**.
