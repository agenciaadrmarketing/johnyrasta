# JohnyWeb V2

Central de acompanhamento dos sites que o webdesigner entrega: quais estão online, quais precisam de atenção, como estão no PageSpeed, onde acontecem cliques e contatos.

**Não é um dashboard.** A abertura é uma biblioteca de projetos e uma lista de trabalho. A identidade visual é o design system Matrix herdado da V1, portado valor a valor.

- Especificação (contrato do produto): `JohnyWeb_V2_Engenharia_e_Prompt.md` (anexo da conversa de origem).
- Matriz requisito → decisão → teste: [`docs/MATRIZ.md`](docs/MATRIZ.md)
- Decisões: [`docs/DECISOES.md`](docs/DECISOES.md) · Progresso: [`docs/PROGRESSO.md`](docs/PROGRESSO.md) · Operação: [`docs/OPERACAO.md`](docs/OPERACAO.md)
- Implantação: [`docs/IMPLANTACAO.md`](docs/IMPLANTACAO.md) · Checklist pré-produção: [`docs/CHECKLIST-PRE-PRODUCAO.md`](docs/CHECKLIST-PRE-PRODUCAO.md) · Backup: [`docs/BACKUP.md`](docs/BACKUP.md) · Instalação no site do cliente: [`docs/INSTALACAO-NO-SITE.md`](docs/INSTALACAO-NO-SITE.md) · Importar a V1: [`docs/IMPORTAR-V1.md`](docs/IMPORTAR-V1.md)

## Estrutura
```
src/app/            telas e rotas (Next.js App Router)
src/modules/        accounts · portfolio · monitoring · performance · analytics · contacts · notifications · reports
src/shared/         db (pools por papel), validation (regras puras), time, ui (design system Matrix)
src/styles/         theme.css — tokens Matrix (fonte da verdade)
worker/             processo separado: verificações HTTP, PageSpeed, outbox de e-mail, retenção, heartbeat
migrations/         SQL versionado, aplicado por scripts/migrate.ts
scripts/            db-setup · migrate · bootstrap · demo · backup · restaurar
tests/              unit · integration (PostgreSQL real) · e2e (Playwright)
tools/              conferir-design.mjs (npm run design)
docs/               decisões, progresso, matriz, operação
```

## Começar
```bash
cp .env.example .env.local && npm install && npm run db:setup && npm run db:bootstrap && npm run dev
```
Em outro terminal: `npm run worker`. Detalhes em `docs/OPERACAO.md`.
