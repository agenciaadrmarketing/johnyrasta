/**
 * Prepara o banco: cria o database (se não existir), os papéis app_web e
 * app_worker com as senhas das respectivas URLs, e roda as migrações.
 *
 *   npm run db:setup           cria e migra
 *   npm run db:setup -- --drop apaga e recria (NUNCA em produção)
 *
 * Lê DATABASE_URL_ADMIN (superusuário ou dono do database), e extrai usuário e
 * senha de DATABASE_URL e DATABASE_URL_WORKER para criar os papéis.
 */
import { Client } from 'pg';
import { loadEnv } from './env';
import { runMigrations } from './migrate';

function partes(url: string) {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
}

async function main() {
  loadEnv();
  const admin = process.env.DATABASE_URL_ADMIN;
  const web = process.env.DATABASE_URL;
  const worker = process.env.DATABASE_URL_WORKER;
  const ingest = process.env.DATABASE_URL_INGEST;
  const forms = process.env.DATABASE_URL_FORMS;
  if (!admin || !web) throw new Error('Defina DATABASE_URL_ADMIN e DATABASE_URL no .env.local.');
  const drop = process.argv.includes('--drop');
  if (drop && process.env.NODE_ENV === 'production') throw new Error('--drop é proibido com NODE_ENV=production.');

  const alvo = partes(admin);
  const raiz = new URL(admin);
  raiz.pathname = '/postgres';
  const c = new Client({ connectionString: raiz.toString() });
  await c.connect();
  try {
    if (drop) {
      await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [alvo.database]);
      await c.query(`drop database if exists "${alvo.database}"`);
      console.log(`· banco ${alvo.database} apagado`);
    }
    const existe = await c.query('select 1 from pg_database where datname = $1', [alvo.database]);
    if (existe.rowCount === 0) {
      await c.query(`create database "${alvo.database}"`);
      console.log(`· banco ${alvo.database} criado`);
    }
    for (const url of [web, worker, ingest, forms]) {
      if (!url) continue;
      const p = partes(url);
      const r = await c.query('select 1 from pg_roles where rolname = $1', [p.user]);
      if (r.rowCount === 0) {
        await c.query(`create role "${p.user}" login password '${p.password.replace(/'/g, "''")}'`);
        console.log(`· papel ${p.user} criado`);
      } else {
        // `with login`: papéis criados NOLOGIN pela migração 0005 ou por db:restaurar precisam virar utilizáveis.
        await c.query(`alter role "${p.user}" with login password '${p.password.replace(/'/g, "''")}'`);
      }
    }
  } finally {
    await c.end();
  }
  await runMigrations(admin);
  console.log('Pronto. Próximo passo: npm run db:bootstrap (cria a conta do proprietário).');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
