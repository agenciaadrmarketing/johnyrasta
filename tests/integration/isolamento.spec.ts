import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { comoConta, criarConta, prepararBanco, urls } from './apoio';

/**
 * A01/A02 e invariantes do schema, contra o Postgres real com RLS forçada.
 */
let admin: Client;
let web: Pool;
let A: { accountId: string; userId: string };
let B: { accountId: string; userId: string };
let clienteA: string;
let siteA: string;

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin });
  await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  A = await criarConta(admin, 'Conta A');
  B = await criarConta(admin, 'Conta B');
  clienteA = await comoConta(web, A.accountId, async (c) => (await c.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [A.accountId, 'Cliente de A'])).rows[0]!.id);
  siteA = await comoConta(web, A.accountId, async (c) =>
    (await c.query<{ id: string }>(
      `insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Site A', 'a.com.br', 'https://a.com.br/', 'pubA') returning id`,
      [A.accountId, clienteA],
    )).rows[0]!.id,
  );
});

afterAll(async () => {
  await web.end();
  await admin.end();
});

describe('isolamento entre contas (RLS)', () => {
  it('A01: conta B não enxerga site nem cliente de A, por id', async () => {
    const r = await comoConta(web, B.accountId, (c) => c.query('select id from sites where id = $1', [siteA]));
    expect(r.rowCount).toBe(0);
    const r2 = await comoConta(web, B.accountId, (c) => c.query('select id from clients where id = $1', [clienteA]));
    expect(r2.rowCount).toBe(0);
  });

  it('A02: sem contexto de conta, app_web não enxerga nada', async () => {
    const r = await comoConta(web, null, (c) => c.query('select count(*)::int as n from sites'));
    expect(r.rows[0]!.n).toBe(0);
  });

  it('B não consegue criar site apontando para cliente de A (chave composta)', async () => {
    await expect(
      comoConta(web, B.accountId, (c) =>
        c.query(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'x', 'b.com', 'https://b.com/', 'pubB')`, [B.accountId, clienteA]),
      ),
    ).rejects.toThrow();
  });

  it('B não consegue gravar linha com account_id de A (with check)', async () => {
    await expect(
      comoConta(web, B.accountId, (c) => c.query('insert into clients (account_id, name) values ($1, $2)', [A.accountId, 'invasor'])),
    ).rejects.toThrow(/row-level security/);
  });

  it('B não atualiza nem arquiva site de A (zero linhas, sem erro que confirme existência)', async () => {
    const r = await comoConta(web, B.accountId, (c) => c.query('update sites set archived_at = now() where id = $1 returning id', [siteA]));
    expect(r.rowCount).toBe(0);
    const ainda = await admin.query('select archived_at from sites where id = $1', [siteA]);
    expect(ainda.rows[0]!.archived_at).toBeNull();
  });

  it('favorito de B num site de A é rejeitado pela chave composta', async () => {
    await expect(
      comoConta(web, B.accountId, (c) => c.query('insert into site_favorites (account_id, user_id, site_id) values ($1, $2, $3)', [B.accountId, B.userId, siteA])),
    ).rejects.toThrow();
  });
});

describe('invariantes do cadastro', () => {
  it('domínio único por conta entre sites ativos; outra conta pode ter o mesmo domínio', async () => {
    await expect(
      comoConta(web, A.accountId, (c) =>
        c.query(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'dup', 'a.com.br', 'https://a.com.br/', 'pubA2')`, [A.accountId, clienteA]),
      ),
    ).rejects.toThrow(/sites_account_domain_key/);
    const clienteB = await comoConta(web, B.accountId, async (c) => (await c.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [B.accountId, 'Cliente de B'])).rows[0]!.id);
    const r = await comoConta(web, B.accountId, (c) =>
      c.query(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'mesmo dominio', 'a.com.br', 'https://a.com.br/', 'pubB2') returning id`, [B.accountId, clienteB]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('o banco recusa domínio não normalizado', async () => {
    await expect(
      comoConta(web, A.accountId, (c) =>
        c.query(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'x', 'www.A.com', 'https://www.a.com/', 'pubA3')`, [A.accountId, clienteA]),
      ),
    ).rejects.toThrow(/sites_domain_normalized/);
  });

  it('um monitor por site; app_web não lê usuários de outra conta', async () => {
    await comoConta(web, A.accountId, (c) => c.query('insert into monitors (account_id, site_id, url) values ($1, $2, $3)', [A.accountId, siteA, 'https://a.com.br/']));
    await expect(
      comoConta(web, A.accountId, (c) => c.query('insert into monitors (account_id, site_id, url) values ($1, $2, $3)', [A.accountId, siteA, 'https://a.com.br/x'])),
    ).rejects.toThrow();
    const u = await comoConta(web, A.accountId, (c) => c.query('select id from users where id = $1', [B.userId]));
    expect(u.rowCount).toBe(0);
  });
});

describe('sessões no banco', () => {
  it('cria, valida, revoga; sessão revogada não autentica', async () => {
    const hash = 'a'.repeat(64);
    const expira = new Date(Date.now() + 3600_000);
    await comoConta(web, null, (c) => c.query('select app.create_session($1, $2, $3, $4, $5)', [A.userId, hash, expira, 'vitest', '']));
    const s = await comoConta(web, null, (c) => c.query('select * from app.find_user_for_session($1)', [hash]));
    expect(s.rows[0]!.account_id).toBe(A.accountId);
    // outra sessão, para o "encerrar as outras"
    await comoConta(web, null, (c) => c.query('select app.create_session($1, $2, $3, $4, $5)', [A.userId, 'b'.repeat(64), expira, 'vitest-2', '']));
    const n = await comoConta(web, null, (c) => c.query<{ n: number }>('select app.revoke_other_sessions($1, $2) as n', [A.userId, hash]));
    expect(n.rows[0]!.n).toBe(1);
    await comoConta(web, null, (c) => c.query('select app.revoke_session($1)', [hash]));
    const depois = await comoConta(web, null, (c) => c.query('select * from app.find_user_for_session($1)', [hash]));
    expect(depois.rowCount).toBe(0);
    // app_web não lê auth_sessions diretamente
    await expect(comoConta(web, A.accountId, (c) => c.query('select * from auth_sessions'))).rejects.toThrow(/permission denied/);
  });
});
