import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { comoConta, criarConta, prepararBanco, urls } from './apoio';
import { hashDoLink, mensagemDeRecuperacao } from '../../src/modules/accounts/recuperacao';

let admin: Client; let web: Pool;
let A: { accountId: string; userId: string };
let email: string;
const agora = () => new Date(Date.now() + 60 * 60_000);
const sql = <T extends object>(q: string, p: unknown[]) => comoConta(web, null, async (c) => (await c.query<T>(q, p)).rows);

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  A = await criarConta(admin, 'Conta Rec');
  email = (await admin.query<{ email: string }>('select email from users where id = $1', [A.userId])).rows[0]!.email;
});
afterAll(async () => { await web.end(); await admin.end(); });

describe('recuperação de senha (funções do banco)', () => {
  it('e-mail desconhecido não cria pedido; conhecido cria, com limite de 3 por hora', async () => {
    expect(await sql('select * from app.request_password_reset($1, $2, $3)', ['ninguem@x.com', hashDoLink('t0'), agora()])).toHaveLength(0);
    expect((await admin.query('select count(*)::int as n from password_resets')).rows[0].n).toBe(0);
    for (const t of ['t1', 't2', 't3']) expect(await sql('select * from app.request_password_reset($1, $2, $3)', [email.toUpperCase(), hashDoLink(t), agora()])).toHaveLength(1);
    expect(await sql('select * from app.request_password_reset($1, $2, $3)', [email, hashDoLink('t4'), agora()])).toHaveLength(0);
  });
  it('o banco guarda só o hash do token, e app_web não lê a tabela', async () => {
    expect((await admin.query("select count(*)::int as n from password_resets where token_hash = 't1'")).rows[0].n).toBe(0);
    await expect(sql('select * from password_resets', [])).rejects.toThrow(/permission denied/);
  });
  it('link válido troca a senha, encerra todas as sessões e só funciona uma vez', async () => {
    await admin.query(`insert into auth_sessions (user_id, account_id, token_hash, expires_at) values ($1, $2, 'sess-x', now() + interval '1 day')`, [A.userId, A.accountId]);
    expect((await sql<{ v: boolean }>('select app.password_reset_valid($1) as v', [hashDoLink('t1')]))[0]!.v).toBe(true);
    const r = await sql<{ user_id: string }>('select * from app.consume_password_reset($1, $2)', [hashDoLink('t1'), 'scrypt$novo']);
    expect(r).toHaveLength(1);
    expect(r[0]!.user_id).toBe(A.userId);
    expect((await admin.query('select password_hash from users where id = $1', [A.userId])).rows[0].password_hash).toBe('scrypt$novo');
    expect((await admin.query("select revoked_at from auth_sessions where token_hash = 'sess-x'")).rows[0].revoked_at).not.toBeNull();
    // Reuso e irmãos pendentes do mesmo usuário: inválidos.
    expect(await sql('select * from app.consume_password_reset($1, $2)', [hashDoLink('t1'), 'scrypt$outro'])).toHaveLength(0);
    expect(await sql('select * from app.consume_password_reset($1, $2)', [hashDoLink('t2'), 'scrypt$outro'])).toHaveLength(0);
    expect((await admin.query('select password_hash from users where id = $1', [A.userId])).rows[0].password_hash).toBe('scrypt$novo');
  });
  it('link vencido ou inexistente é inválido', async () => {
    await admin.query("delete from password_resets");
    await admin.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, now() - interval '1 minute')`, [A.userId, hashDoLink('velho')]);
    expect((await sql<{ v: boolean }>('select app.password_reset_valid($1) as v', [hashDoLink('velho')]))[0]!.v).toBe(false);
    expect(await sql('select * from app.consume_password_reset($1, $2)', [hashDoLink('velho'), 'x'])).toHaveLength(0);
    expect((await sql<{ v: boolean }>('select app.password_reset_valid($1) as v', [hashDoLink('nunca')]))[0]!.v).toBe(false);
  });
  it('a mensagem leva o link e não promete o que não faz', () => {
    const m = mensagemDeRecuperacao('Ana', 'https://c.test/redefinir-senha?token=abc');
    expect(m.text).toContain('https://c.test/redefinir-senha?token=abc');
    expect(m.text).toContain('60 minutos');
  });
});
