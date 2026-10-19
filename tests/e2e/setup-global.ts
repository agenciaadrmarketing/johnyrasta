import { Client } from 'pg';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { hashPassword } from '../../src/modules/accounts/password';

/**
 * Garante duas contas de teste (A e B) no banco de desenvolvimento, com senha
 * conhecida, e um site em B para os testes de isolamento. Reaproveita se já
 * existirem. Usa DATABASE_URL_ADMIN.
 */
export const CONTA_A = { email: 'e2e-a@teste.local', senha: 'senha-e2e-conta-a', nome: 'Operador A' };
export const CONTA_B = { email: 'e2e-b@teste.local', senha: 'senha-e2e-conta-b', nome: 'Operador B' };

export default async function setup() {
  for (const f of ['.env.test', '.env.local']) if (existsSync(f)) config({ path: f, override: false, quiet: true });
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('E2E exige DATABASE_URL_ADMIN.');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const conta of [CONTA_A, CONTA_B]) {
      const existe = await c.query('select 1 from users where lower(email) = lower($1)', [conta.email]);
      if (existe.rowCount) continue;
      const a = await c.query<{ id: string }>('insert into accounts (name) values ($1) returning id', [`E2E ${conta.nome}`]);
      await c.query('insert into users (account_id, email, password_hash, name) values ($1, $2, $3, $4)', [a.rows[0]!.id, conta.email, await hashPassword(conta.senha), conta.nome]);
    }
    // Site da conta B, alvo dos testes de isolamento.
    const b = await c.query<{ account_id: string }>('select account_id from users where lower(email) = lower($1)', [CONTA_B.email]);
    const accountB = b.rows[0]!.account_id;
    const site = await c.query('select id from sites where account_id = $1 limit 1', [accountB]);
    if (!site.rowCount) {
      const cl = await c.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [accountB, 'Cliente secreto de B']);
      await c.query(
        `insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Site secreto de B', 'secreto-b.exemplo.com', 'https://secreto-b.exemplo.com/', 'e2e-pub-b')`,
        [accountB, cl.rows[0]!.id],
      );
    }
  } finally {
    await c.end();
  }
}
