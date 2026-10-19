/**
 * Cria a conta do proprietário. Sem senha padrão: a senha vem do ambiente ou
 * de prompt interativo, e o script se recusa a rodar se já houver usuário.
 *
 *   BOOTSTRAP_ACCOUNT="ADR Marketing" BOOTSTRAP_NAME="Johny" \
 *   BOOTSTRAP_EMAIL="voce@agencia.com" BOOTSTRAP_PASSWORD="…" npm run db:bootstrap
 *
 * Usa DATABASE_URL_ADMIN (a RLS não se aplica ao administrador).
 */
import { Client } from 'pg';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadEnv } from './env';
import { hashPassword, SENHA_MINIMA } from '../src/modules/accounts/password';

async function perguntar(rotulo: string, oculto = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  if (oculto && stdin.isTTY) {
    stdout.write(rotulo);
    stdin.setRawMode(true);
    const r = await rl.question('');
    stdin.setRawMode(false);
    stdout.write('\n');
    rl.close();
    return r;
  }
  const r = await rl.question(rotulo);
  rl.close();
  return r;
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('Defina DATABASE_URL_ADMIN.');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const existe = await c.query('select count(*)::int as n from users where account_id in (select id from accounts where not is_demo)');
    if (existe.rows[0].n > 0 && !process.env.BOOTSTRAP_FORCE) {
      throw new Error('Já existe um usuário. Crie outros pela aplicação (Fase posterior) ou use BOOTSTRAP_FORCE=1 para adicionar mais um proprietário.');
    }
    const conta = process.env.BOOTSTRAP_ACCOUNT || (await perguntar('Nome da conta (ex.: sua agência): '));
    const nome = process.env.BOOTSTRAP_NAME || (await perguntar('Seu nome: '));
    const email = process.env.BOOTSTRAP_EMAIL || (await perguntar('E-mail de acesso: '));
    const senha = process.env.BOOTSTRAP_PASSWORD || (await perguntar('Senha: ', true));
    if (!conta.trim() || !nome.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Conta, nome e e-mail válidos são obrigatórios.');
    if (senha.length < SENHA_MINIMA) throw new Error(`A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`);
    const hash = await hashPassword(senha);
    await c.query('begin');
    const a = await c.query<{ id: string }>('insert into accounts (name) values ($1) returning id', [conta.trim()]);
    await c.query('insert into users (account_id, email, password_hash, name, role) values ($1, $2, $3, $4, $5)', [a.rows[0]!.id, email.trim(), hash, nome.trim(), 'owner']);
    await c.query('commit');
    console.log(`Conta "${conta.trim()}" criada. Entre com ${email.trim()}.`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
