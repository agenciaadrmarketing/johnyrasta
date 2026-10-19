import { Client, Pool } from 'pg';
import { randomBytes } from 'node:crypto';

/**
 * Banco de teste separado (`johnyweb_test`), criado do zero com as migrações
 * reais e os papéis reais. Os testes falam com o banco como `app_web`, pelo
 * mesmo caminho da aplicação: transação + SET LOCAL app.account_id.
 */
export const BANCO_TESTE = 'johnyweb_test';

function url(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

export function urls() {
  const admin = process.env.DATABASE_URL_ADMIN;
  const web = process.env.DATABASE_URL;
  if (!admin || !web) throw new Error('Testes de integração exigem DATABASE_URL_ADMIN e DATABASE_URL (.env.local).');
  return { admin: url(admin, BANCO_TESTE), web: url(web, BANCO_TESTE), adminRaiz: url(admin, 'postgres') };
}

export async function prepararBanco(): Promise<void> {
  const { adminRaiz, admin } = urls();
  const raiz = new Client({ connectionString: adminRaiz });
  await raiz.connect();
  await raiz.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [BANCO_TESTE]);
  await raiz.query(`drop database if exists ${BANCO_TESTE}`);
  await raiz.query(`create database ${BANCO_TESTE}`);
  await raiz.end();
  const { runMigrations } = await import('../../scripts/migrate');
  await runMigrations(admin, true);
}

export async function comoConta<T>(pool: Pool, accountId: string | null, fn: (c: Client | import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (accountId) await c.query("select set_config('app.account_id', $1, true)", [accountId]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function criarConta(admin: Client, nome: string): Promise<{ accountId: string; userId: string }> {
  const a = await admin.query<{ id: string }>('insert into accounts (name) values ($1) returning id', [nome]);
  const u = await admin.query<{ id: string }>(
    "insert into users (account_id, email, password_hash, name) values ($1, $2, 'scrypt$32768$x$y', $3) returning id",
    [a.rows[0]!.id, `${randomBytes(4).toString('hex')}@teste.local`, nome],
  );
  return { accountId: a.rows[0]!.id, userId: u.rows[0]!.id };
}
