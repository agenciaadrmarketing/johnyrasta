/**
 * Administrador SEM BYPASSRLS (caso do `postgres` de um PostgreSQL gerenciado, se o provedor não o der).
 *
 * As tabelas da central têm RLS FORÇADA, que vale até para o dono. Duas coisas dependem de o dono
 * enxergar as linhas, hoje por ser superusuário ou ter BYPASSRLS:
 *   1. as funções SECURITY DEFINER de login/sessão/recuperação de senha (rodam como dono);
 *   2. as operações do administrador: bootstrap, demo, importação da V1, pg_dump, pg_restore e a
 *      contagem da verificação de restauração.
 * Sem o privilégio, o login devolve zero linhas e o `pg_dump` falha.
 *
 * Adaptação de menor privilégio: uma política explícita `TO <administrador>` em cada tabela com RLS.
 * Política é restrita ao papel nomeado: `app_web`, `app_worker`, `app_ingest` e `app_forms` continuam
 * sujeitos às suas políticas por conta, nada é desligado, e o administrador não vira conexão da
 * aplicação. Ele já era dono de tudo e as funções DEFINER já rodavam com esse poder; a política só o
 * torna explícito e auditável (`select * from pg_policies where policyname like 'admin\_%'`).
 *
 * Idempotente. É chamada ao fim de `runMigrations` (cobre tabelas de migrações futuras); não faz
 * nada quando o administrador é superusuário ou tem BYPASSRLS.
 */
import type { Client } from 'pg';

export async function adminIgnoraRls(c: Client): Promise<{ ignora: boolean; papel: string }> {
  const r = await c.query<{ papel: string; ok: boolean }>(`select r.rolname as papel, (r.rolsuper or r.rolbypassrls) as ok from pg_roles r where r.rolname = current_user`);
  return { papel: r.rows[0]!.papel, ignora: r.rows[0]!.ok };
}

/** Cria/recria as políticas do administrador. Devolve quantas tabelas receberam política (0 = não precisava). */
export async function garantirPoliticasDoAdministrador(c: Client): Promise<number> {
  const { ignora, papel } = await adminIgnoraRls(c);
  if (ignora) return 0;
  const tabelas = await c.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by 1`,
  );
  for (const { t } of tabelas.rows) {
    const nome = `admin_${t}`;
    await c.query(`drop policy if exists "${nome}" on "${t}"`);
    await c.query(`create policy "${nome}" on "${t}" for all to "${papel.replace(/"/g, '""')}" using (true) with check (true)`);
  }
  return tabelas.rowCount ?? 0;
}

/** O administrador consegue LER as linhas? (Falso = um backup sairia vazio ou falharia.) */
export async function adminEnxergaLinhas(c: Client): Promise<boolean> {
  const { ignora } = await adminIgnoraRls(c);
  if (ignora) return true;
  const r = await c.query<{ n: string }>(
    `select count(*)::text as n from pg_policies where schemaname = 'public' and tablename = 'accounts' and policyname = 'admin_accounts'`,
  );
  return Number(r.rows[0]!.n) > 0;
}
