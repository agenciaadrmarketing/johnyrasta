# Compatibilidade entre código, schema e permissões

"Migração aditiva" **não** basta para dizer que o código anterior funciona sobre o schema novo: migrações também mudam permissões (a 0008 retirou leituras do worker) e restrições (a 0009 ampliou um `check`). O que vale é o que foi **executado**, e só o que está na tabela abaixo.

## Versões do schema

| Migração | Introduz | Commit |
|---|---|---|
| 0001–0004 | fundação, RLS e papéis, disponibilidade, velocidade | Fases 1–3 |
| 0005 | eventos, contatos, papéis `app_ingest` e `app_forms` | Fase 4 |
| 0006, 0007 | notificações, retenção de contatos | Fase 5 |
| 0008 | endurecimento: o worker deixa de ler `submissions.fields`; permissão em `sessions` | `c30a982` |
| 0009 | tipo de alerta `regressao_pagespeed` | `8bb4319` |
| 0010 | recuperação de senha (`password_resets`, funções `app.*`) | `a61d56a` |

Commits `68042a1`, `e39cb70` e `464ac12`/posteriores usam **o mesmo schema** (0001–0010).

## Regra de implantação

1. **Schema primeiro, código depois.** O código novo exige o schema novo: `npm run db:migrate` antes de subir web e worker.
2. **Web e worker sempre da mesma versão** (mesmo commit), porque dividem estados gravados no banco.

## Matriz verificada

Método: banco de teste separado, com **as migrações 0001–0010 do commit atual**, e a suíte completa (unidade + integração) do commit testado rodando contra ele. Playwright não foi repetido nos commits antigos.

| Código | Sobre o schema | Resultado | Leitura |
|---|---|---|---|
| `e39cb70` e posteriores (atual) | 0001–0010 | **ok** (todos os testes passam; última verificação completa registrada em `docs/PROGRESSO.md`) | referência |
| `68042a1` | 0001–0010 | **206 de 206 passam** | compatível (o schema é idêntico ao atual) |
| `c30a982` (Fase 5 corrigida) | 0001–0010 | **193 de 196 passam**; as 3 falhas são a **matriz de permissões antiga**, que enumera todas as tabelas e funções e por isso reprova a tabela `password_resets` e as 3 funções novas | compatível no comportamento testado; a matriz desse commit não conhece o schema novo, o que é esperado |
| atual (`e39cb70`+) | 0001–0008 (sem 0009 e 0010) | **208 de 214 passam; 6 falham** (alerta de regressão, recuperação de senha, lista de funções) | **não suportado**: o código novo exige 0009 e 0010 |
| anteriores a `c30a982` (`b595a16` e antes) | qualquer | **não verificado** | não declarado compatível; não voltar a elas sem uma verificação nova |

Efeitos que só a leitura do código mostra (não foram exercitados por teste de volta): ao voltar para `c30a982`, alertas já gravados com o tipo `regressao_pagespeed` aparecem com o nome interno do tipo em vez do rótulo; a tabela `password_resets` fica sem uso; e o link "Esqueci minha senha" deixa de existir.

## Retorno ao commit anterior

- **Declarado validado:** voltar de `e39cb70`/atual para **`68042a1`** (mesmo schema, 206/206).
- **Voltar para `c30a982`** (Fase 5): suportado com as ressalvas acima, **sem** reverter o banco.
- **Qualquer outro commit:** não validado. Se for preciso, restaure um backup anterior à migração num banco novo (`docs/BACKUP.md`) e rode a verificação da matriz para o commit desejado antes de promovê-lo.
- Reverter migrações não é suportado: nenhuma tem "down". Voltar o schema = restaurar backup (perde o que foi gravado depois dele).
- Antes do primeiro deploy do piloto não existe versão anterior em produção: a coluna "retorno" só passa a valer a partir do segundo deploy.

## Como repetir a verificação

```bash
git worktree add /tmp/wt-ANTIGO <sha-antigo>
ln -s "$PWD/node_modules" /tmp/wt-ANTIGO/node_modules && cp .env.local /tmp/wt-ANTIGO/
rm -rf /tmp/wt-ANTIGO/migrations && cp -r migrations /tmp/wt-ANTIGO/migrations     # schema ATUAL
(cd /tmp/wt-ANTIGO && TEST_DB_NAME=jw_compat_antigo npx vitest run)
git worktree remove --force /tmp/wt-ANTIGO       # e apague o banco jw_compat_antigo
```
