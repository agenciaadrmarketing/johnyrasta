# Importar o cadastro da V1

Traz **clientes, sites e URLs prioritárias**. Não traz eventos, leads nem medições de velocidade: a V1 mede de outro jeito (outro modelo de sessão e outra janela), e emendar as séries inventaria uma continuidade que não existe. Os números da V2 começam quando o coletor da V2 é instalado em cada site.

A V1 só é **lida**, por você, com uma consulta; o script da V2 nunca se conecta a ela.

## 1. Exportar da V1

No banco da V1 (somente leitura), gere o JSON:

```sql
select json_build_object(
  'clients', (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'notes', notes, 'archived_at', archived_at)), '[]') from clients where account_id = '<ID DA CONTA NA V1>'),
  'sites', (select coalesce(json_agg(json_build_object('id', id, 'client_id', client_id, 'name', name, 'domain', domain, 'timezone', timezone, 'archived_at', archived_at)), '[]') from sites where account_id = '<ID DA CONTA NA V1>'),
  'monitored_urls', (select coalesce(json_agg(json_build_object('site_id', site_id, 'url', url, 'prioritaria', prioritaria)), '[]') from monitored_urls where account_id = '<ID DA CONTA NA V1>')
);
```

Salve o resultado como `v1.json` (por exemplo com `psql -At -f consulta.sql > v1.json`). Se a sua V1 tiver a coluna `platform` em `sites`, inclua-a; sem ela, todos entram como plataforma "outro".

## 2. Simular

```bash
npm run db:importar-v1 -- --arquivo v1.json --conta <ID DA CONTA NA V2>
```

Mostra, linha a linha, o que seria criado, reaproveitado ou ignorado, com o motivo. **Nada é gravado.**

## 3. Aplicar

```bash
npm run db:importar-v1 -- --arquivo v1.json --conta <ID DA CONTA NA V2> --aplicar [--monitorar]
```

Tudo numa transação: ou entra inteiro ou não entra nada. Rodar duas vezes é seguro: sites cujo domínio já existe são ignorados e clientes com o mesmo nome são reaproveitados.

## Regras

- **Ignorados, com motivo**: site ou cliente arquivado na V1, domínio inválido ou IP, nome fora de 2–80 caracteres, domínio já cadastrado na V2.
- **URL principal**: a V1 guardava só o domínio; a V2 grava `https://<domínio>` como principal. Confira e corrija nos sites que usam `http` ou outro caminho.
- **Fuso e plataforma** desconhecidos viram `America/Sao_Paulo` e `outro`.
- **URLs prioritárias**: só as do mesmo domínio do site, no máximo 3, sem parâmetros de busca.
- **Monitoramento de disponibilidade** só liga com `--monitorar`. Sem a flag, cada site começa sem monitor e a central diz isso.
- **Código de instalação**: cada site ganha um identificador público novo. O snippet antigo da V1 continua enviando para a V1; instale o da V2 (aba Instalação do site) para começar a coletar.
- A importação fica registrada no histórico de auditoria da conta (`importacao.v1`).
