import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { criarConta, prepararBanco, urls, BANCO_TESTE } from './apoio';
import { adminEnxergaLinhas, garantirPoliticasDoAdministrador } from '../../scripts/rls-admin';

/**
 * Administrador SEM BYPASSRLS (PostgreSQL gerenciado). Reproduz o pior caso: o dono das tabelas e das
 * funções SECURITY DEFINER não ignora a RLS forçada. Sem as políticas admin_*, o login devolve zero linhas.
 */
let su: Client; let adm: Client; let web: Client;
const PAPEL = 'adm_sem_bypass_t';
const SENHA = 'senha-adm-teste';

beforeAll(async () => {
  await prepararBanco();
  su = new Client({ connectionString: urls().admin }); await su.connect();
  await su.query(`drop role if exists ${PAPEL}`).catch(() => {});
  await su.query(`create role ${PAPEL} login createrole password '${SENHA}'`);
  // Passa a propriedade de tudo ao papel restrito, como num banco gerenciado.
  await su.query(`do $$ declare r record; begin
    for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') loop
      execute format('alter table %I owner to ${PAPEL}', r.relname);
    end loop;
    for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' loop
      execute format('alter function %s owner to ${PAPEL}', r.f);
    end loop; end $$`);
  await su.query(`grant create, usage on schema public to ${PAPEL}`);
  const u = new URL(urls().admin); u.username = PAPEL; u.password = SENHA;
  adm = new Client({ connectionString: u.toString() }); await adm.connect();
  const w = new URL(process.env.DATABASE_URL!); w.pathname = `/${BANCO_TESTE}`;
  web = new Client({ connectionString: w.toString() }); await web.connect();
  const conta = await criarConta(su, 'Conta Adm');
  await su.query('update users set email = $2 where id = $1', [conta.userId, 'adm@teste.local']);
});
afterAll(async () => {
  await adm.end(); await web.end();
  await su.query(`reassign owned by ${PAPEL} to postgres`).catch(() => {});
  await su.query(`drop owned by ${PAPEL}`).catch(() => {});
  await su.query(`drop role if exists ${PAPEL}`).catch(() => {});
  await su.end();
});

describe('administrador sem BYPASSRLS', () => {
  it('SEM políticas: o login (SECURITY DEFINER do dono) devolve zero linhas e o administrador não enxerga as contas', async () => {
    expect(await adminEnxergaLinhas(adm)).toBe(false);
    expect((await adm.query('select count(*)::int as n from accounts')).rows[0].n).toBe(0);
    expect((await web.query("select count(*)::int as n from app.find_user_for_login('adm@teste.local')")).rows[0].n).toBe(0);
  });
  it('COM políticas admin_*: o login e o administrador funcionam; as contas continuam isoladas para os papéis da aplicação', async () => {
    expect(await garantirPoliticasDoAdministrador(adm)).toBeGreaterThan(20);
    expect(await adminEnxergaLinhas(adm)).toBe(true);
    expect((await web.query("select count(*)::int as n from app.find_user_for_login('adm@teste.local')")).rows[0].n).toBe(1);
    expect((await adm.query('select count(*)::int as n from accounts')).rows[0].n).toBeGreaterThan(0);
    // O papel da aplicação continua SEM enxergar contas sem contexto (isolamento intacto).
    expect((await web.query('select count(*)::int as n from accounts')).rows[0].n).toBe(0);
    // Idempotente.
    expect(await garantirPoliticasDoAdministrador(adm)).toBeGreaterThan(20);
  });
  it('quem já ignora a RLS (superusuário) não recebe política nenhuma', async () => {
    expect(await garantirPoliticasDoAdministrador(su)).toBe(0);
  });
});
