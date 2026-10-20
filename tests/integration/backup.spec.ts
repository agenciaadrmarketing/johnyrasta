import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';
import { fazerBackup, urlParaBanco } from '../../scripts/backup';
import { restaurarBackup } from '../../scripts/restaurar';
import { verificarRestauracao } from '../../scripts/verificar-restauracao';

/**
 * Backup com pg_dump e restauração com pg_restore num banco separado, contra o
 * PostgreSQL real: contagens, migrações, políticas e concessões iguais — e a
 * RLS continua valendo no banco restaurado. Rode com TEST_DB_NAME exclusivo.
 */
const temFerramentas = ['pg_dump', 'pg_restore'].every((b) => {
  try {
    return spawnSync(b, ['--version']).status === 0;
  } catch {
    return false;
  }
});
const ALVO = `${BANCO_TESTE}_restaurado`;

if (!temFerramentas) console.warn('[backup.spec] pg_dump/pg_restore não estão no PATH: suíte de backup PULADA.');

describe.skipIf(!temFerramentas)(temFerramentas ? 'backup e restauração' : 'backup e restauração — PULADO: pg_dump/pg_restore não estão no PATH', () => {
  let admin: Client;
  let web: Pool;
  let dir: string;
  let arquivo: string;
  let conta: { accountId: string; userId: string };
  let outra: { accountId: string; userId: string };
  const semeado = { sites: 2, eventos: 12, submissoes: 2, contatos: 2 };

  async function derrubarAlvo() {
    const raiz = new Client({ connectionString: urls().adminRaiz });
    await raiz.connect();
    try {
      await raiz.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [ALVO]);
      await raiz.query(`drop database if exists ${ALVO}`);
    } finally {
      await raiz.end();
    }
  }

  beforeAll(async () => {
    await prepararBanco();
    await derrubarAlvo();
    const u = urls();
    admin = new Client({ connectionString: u.admin });
    await admin.connect();
    web = new Pool({ connectionString: u.web, max: 2 });
    conta = await criarConta(admin, 'Conta Backup');
    outra = await criarConta(admin, 'Outra Conta');
    const cliente = (await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'Cliente'])).rows[0]!.id;
    const sites: string[] = [];
    for (let i = 0; i < semeado.sites; i += 1) {
      const s = await admin.query<{ id: string }>(
        `insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, $3, $4, $5, $6) returning id`,
        [conta.accountId, cliente, `Site ${i}`, `site${i}.exemplo.com.br`, `https://site${i}.exemplo.com.br/`, `pub-backup-${i}`],
      );
      sites.push(s.rows[0]!.id);
      await admin.query('insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, now())', [conta.accountId, s.rows[0]!.id, `https://site${i}.exemplo.com.br/`]);
    }
    const sessao = (
      await admin.query<{ id: string }>(
        `insert into sessions (account_id, site_id, session_key, started_at, last_seen_at, entry_path) values ($1, $2, 'sess-backup-1', now(), now(), '/') returning id`,
        [conta.accountId, sites[0]],
      )
    ).rows[0]!.id;
    for (let i = 0; i < semeado.eventos; i += 1) {
      await admin.query(
        `insert into events (account_id, site_id, event_id, session_id, type, path, button_id, action_kind, occurred_at)
         values ($1, $2, $3, $4, $5, '/', $6, $7, now() - make_interval(secs => $8))`,
        [conta.accountId, sites[0], `ev-${i}`, sessao, i % 3 === 0 ? 'click' : 'page_view', i % 3 === 0 ? 'whatsapp-topo' : null, i % 3 === 0 ? 'whatsapp' : null, i * 10],
      );
    }
    for (let i = 0; i < semeado.submissoes; i += 1) {
      const c = (await admin.query<{ id: string }>('insert into contacts (account_id, site_id, name, first_real_at, last_real_at) values ($1, $2, $3, now(), now()) returning id', [conta.accountId, sites[0], `Pessoa ${i}`])).rows[0]!.id;
      await admin.query('insert into contact_identities (account_id, site_id, contact_id, kind, value) values ($1, $2, $3, $4, $5)', [conta.accountId, sites[0], c, 'email', `pessoa${i}@exemplo.com`]);
      await admin.query(
        `insert into submissions (account_id, site_id, submission_id, mode, receipt_status, evidence_source, contact_id, fields, occurred_at)
         values ($1, $2, $3, 'endpoint', 'recebido', 'endpoint da central', $4, '{"name":"x"}', now())`,
        [conta.accountId, sites[0], `sub-backup-${i}`, c],
      );
    }
    dir = await mkdtemp(join(tmpdir(), 'johnyweb-backup-'));
  });

  afterAll(async () => {
    await web.end();
    await admin.end();
    await derrubarAlvo();
    await rm(dir, { recursive: true, force: true });
  });

  it('gera um .dump com nome datado no diretório informado', async () => {
    const r = await fazerBackup({ url: urls().admin, dir, quiet: true });
    arquivo = r.caminho;
    expect(existsSync(arquivo)).toBe(true);
    expect(r.bytes).toBeGreaterThan(1024);
    expect(r.banco).toBe(BANCO_TESTE);
    expect(basename(arquivo)).toMatch(/^johnyweb-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.dump$/);
    // Segundo backup no mesmo minuto não sobrescreve o primeiro.
    const r2 = await fazerBackup({ url: urls().admin, dir, quiet: true, agora: new Date(basename(arquivo).slice(9, 25).replace(/T(\d{2})-(\d{2})$/, 'T$1:$2:00Z')) });
    expect(r2.caminho).not.toBe(arquivo);
    expect(basename(r2.caminho)).toMatch(/-2\.dump$/);
  });

  it('recusa restaurar sobre o banco de origem ou sobre bancos de sistema', async () => {
    await expect(restaurarBackup({ urlAdmin: urls().admin, arquivo, para: BANCO_TESTE, quiet: true })).rejects.toThrow(/banco de origem/);
    await expect(restaurarBackup({ urlAdmin: urls().admin, arquivo, para: 'postgres', quiet: true })).rejects.toThrow(/sistema/);
    await expect(restaurarBackup({ urlAdmin: urls().admin, arquivo, para: 'Nome-Invalido', quiet: true })).rejects.toThrow(/inválido/);
    await expect(restaurarBackup({ urlAdmin: urls().admin, arquivo: join(dir, 'nao-existe.dump'), para: ALVO, quiet: true })).rejects.toThrow(/não encontrado/);
  });

  it('restaura num banco novo com contagens, migrações, políticas e concessões iguais', async () => {
    const r = await restaurarBackup({ urlAdmin: urls().admin, arquivo, para: ALVO, quiet: true });
    expect(r.alvoCriado).toBe(true);
    expect(r.papeisCriados).toEqual([]);
    expect(r.cabecalho.banco).toBe(BANCO_TESTE);
    const v = r.verificacao!;
    expect(v.estruturaOk).toBe(true);
    expect(v.contagensIguais).toBe(true);
    expect(v.tabelasAusentes).toEqual([]);
    expect(v.migracoes.iguais).toBe(true);
    expect(v.migracoes.alvo.length).toBeGreaterThanOrEqual(5);
    expect(v.politicas.alvo).toBe(v.politicas.origem);
    expect(v.politicas.alvo).toBeGreaterThan(0);
    expect(v.concessoes.alvo).toBe(v.concessoes.origem);
    const contagem = (nome: string) => v.tabelas.find((t) => t.nome === `public.${nome}`)!;
    expect(contagem('events')).toMatchObject({ origem: semeado.eventos, alvo: semeado.eventos });
    expect(contagem('sites')).toMatchObject({ origem: semeado.sites, alvo: semeado.sites });
    expect(contagem('submissions')).toMatchObject({ origem: semeado.submissoes, alvo: semeado.submissoes });
    expect(contagem('contacts')).toMatchObject({ origem: semeado.contatos, alvo: semeado.contatos });
  });

  it('no banco restaurado a RLS forçada e as concessões continuam valendo', async () => {
    const webRestaurado = new Pool({ connectionString: urlParaBanco(urls().web, ALVO), max: 2 });
    try {
      const semContexto = await comoConta(webRestaurado, null, (c) => c.query<{ n: number }>('select count(*)::int as n from sites'));
      expect(semContexto.rows[0]!.n).toBe(0);
      const daConta = await comoConta(webRestaurado, conta.accountId, (c) => c.query<{ n: number }>('select count(*)::int as n from sites'));
      expect(daConta.rows[0]!.n).toBe(semeado.sites);
      const deOutra = await comoConta(webRestaurado, outra.accountId, (c) => c.query<{ n: number }>('select count(*)::int as n from sites'));
      expect(deOutra.rows[0]!.n).toBe(0);
      await expect(comoConta(webRestaurado, conta.accountId, (c) => c.query('select count(*) from auth_sessions'))).rejects.toThrow(/permission denied/);
    } finally {
      await webRestaurado.end();
    }
    const urlIngest = process.env.DATABASE_URL_INGEST;
    if (urlIngest) {
      const ingest = new Client({ connectionString: urlParaBanco(urlIngest, ALVO) });
      await ingest.connect();
      try {
        await expect(ingest.query('select count(*) from contacts')).rejects.toThrow(/permission denied/);
        expect((await ingest.query<{ n: number }>('select count(*)::int as n from sites')).rows[0]!.n).toBe(semeado.sites);
      } finally {
        await ingest.end();
      }
    }
  });

  it('recusa sobrescrever um alvo com conteúdo sem --forcar; com --forcar recria', async () => {
    await expect(restaurarBackup({ urlAdmin: urls().admin, arquivo, para: ALVO, quiet: true })).rejects.toThrow(/--forcar/);
    const r = await restaurarBackup({ urlAdmin: urls().admin, arquivo, para: ALVO, forcar: true, quiet: true });
    expect(r.alvoRecriado).toBe(true);
    expect(r.verificacao!.estruturaOk).toBe(true);
    expect(r.verificacao!.contagensIguais).toBe(true);
  });

  it('a verificação acusa divergência quando origem e alvo deixam de bater', async () => {
    await admin.query(`insert into clients (account_id, name) values ($1, 'Depois do backup')`, [conta.accountId]);
    const v = await verificarRestauracao({ urlOrigem: urls().admin, urlAlvo: urlParaBanco(urls().admin, ALVO) });
    expect(v.estruturaOk).toBe(true);
    expect(v.contagensIguais).toBe(false);
    expect(v.contagensDiferentes).toEqual(['public.clients']);
    const alvo = new Client({ connectionString: urlParaBanco(urls().admin, ALVO) });
    await alvo.connect();
    try {
      await alvo.query('drop policy sites_tenant on sites');
      await alvo.query('revoke select on contacts from app_web');
    } finally {
      await alvo.end();
    }
    const v2 = await verificarRestauracao({ urlOrigem: urls().admin, urlAlvo: urlParaBanco(urls().admin, ALVO) });
    expect(v2.estruturaOk).toBe(false);
    expect(v2.politicas.ausentes).toEqual(['public.sites.sites_tenant']);
    expect(v2.concessoes.ausentes).toEqual(['public.contacts → app_web: SELECT']);
  });
});
