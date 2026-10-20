/**
 * Aplica `migrations/*.sql` em ordem, uma vez cada, cada uma numa transação.
 * Usa DATABASE_URL_ADMIN: migração precisa de privilégio de DDL.
 */
import { Client } from 'pg';
import { configDoPg } from '../src/shared/db/tls';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from './env';

const DIR = 'migrations';

export async function runMigrations(connectionString: string, quiet = false): Promise<number> {
  const client = new Client(configDoPg(connectionString));
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const applied = new Set(
      (await client.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version),
    );
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = await readFile(join(DIR, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [version]);
        await client.query('commit');
        if (!quiet) console.log(`· aplicada ${version}`);
        count += 1;
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Falha na migração ${version}: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!quiet) console.log(count ? `${count} migração(ões) aplicada(s)` : 'nenhuma migração pendente');
    return count;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  loadEnv();
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('Defina DATABASE_URL_ADMIN no .env.local.');
  runMigrations(url).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
