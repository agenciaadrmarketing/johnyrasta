import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';
import { rodada, gravar } from '../../worker/rodada';
import { reivindicar } from '../../worker/fila';
import type { ResultadoDaChecagem } from '@/modules/monitoring/transicao';

/**
 * Aceite da Fase 2 contra o Postgres real, com o verificador substituído por
 * uma sequência controlada: 200 → 500 → 500 (confirma) → 500 × 8 → 200 (recupera).
 */
let admin: Client;
let web: Pool;
let worker: Pool;
let conta: { accountId: string; userId: string };
let monitorId: string;
let siteId: string;
let relogio = new Date('2026-10-19T12:00:00Z');
const avanca = (min: number) => { relogio = new Date(relogio.getTime() + min * 60_000); };

const ok: ResultadoDaChecagem = { ok: true, httpStatus: 200, durationMs: 80, errorCategory: null, errorDetail: null, finalUrl: 'https://teste.exemplo.com/', redirects: 0, tlsExpiresAt: new Date('2027-01-01T00:00:00Z'), tlsState: 'valido' };
const falha: ResultadoDaChecagem = { ...ok, ok: false, httpStatus: 500, errorCategory: 'http', errorDetail: 'HTTP 500', tlsExpiresAt: null, tlsState: 'desconhecido' };
let proximo: ResultadoDaChecagem = ok;

async function umaRodada() {
  const r = await rodada(worker, { workerId: 'teste', verificar: async () => proximo, agora: () => relogio });
  return r;
}
async function forcarDevido() {
  await admin.query('update monitors set next_check_at = $2 where id = $1', [monitorId, relogio]);
}

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin });
  await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  const workerUrl = new URL(process.env.DATABASE_URL_WORKER!);
  workerUrl.pathname = `/${BANCO_TESTE}`;
  worker = new Pool({ connectionString: workerUrl.toString(), max: 4 });
  conta = await criarConta(admin, 'Conta Fluxo');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const s = await admin.query<{ id: string }>(
    `insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Teste', 'teste.exemplo.com', 'https://teste.exemplo.com/', 'pubT') returning id`,
    [conta.accountId, c.rows[0]!.id],
  );
  siteId = s.rows[0]!.id;
  const m = await admin.query<{ id: string }>('insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, $4) returning id', [conta.accountId, siteId, 'https://teste.exemplo.com/', relogio]);
  monitorId = m.rows[0]!.id;
});
afterAll(async () => {
  await worker.end();
  await web.end();
  await admin.end();
});

describe('fluxo 200 → 500 → confirmação → recuperação', () => {
  it('200: grava checagem, sem incidente, agenda próxima em 5 min, TLS válido', async () => {
    proximo = ok;
    const r = await umaRodada();
    expect(r).toMatchObject({ reivindicados: 1, gravados: 1, descartados: 0 });
    const m = await admin.query('select * from monitors where id = $1', [monitorId]);
    expect(m.rows[0].last_ok).toBe(true);
    expect(m.rows[0].lease_token).toBeNull();
    expect(new Date(m.rows[0].next_check_at).getTime()).toBe(relogio.getTime() + 300_000);
    expect(m.rows[0].tls_state).toBe('valido');
    expect((await admin.query('select count(*)::int as n from incidents')).rows[0].n).toBe(0);
  });

  it('nada devido: a rodada não reivindica (não verifica antes da hora)', async () => {
    const r = await umaRodada();
    expect(r.reivindicados).toBe(0);
  });

  it('1ª falha: incidente aberto NÃO confirmado, nenhum alerta', async () => {
    avanca(5); proximo = falha;
    await umaRodada();
    const i = await admin.query('select * from incidents where monitor_id = $1', [monitorId]);
    expect(i.rowCount).toBe(1);
    expect(i.rows[0].confirmed_at).toBeNull();
    expect((await admin.query('select count(*)::int as n from alerts')).rows[0].n).toBe(0);
  });

  it('2ª falha: confirma e gera UM alerta alto, visível para a conta pela RLS', async () => {
    avanca(5);
    await umaRodada();
    const i = await admin.query('select * from incidents where monitor_id = $1', [monitorId]);
    expect(i.rows[0].confirmed_at).not.toBeNull();
    expect(i.rows[0].failed_checks).toBe(2);
    const a = await comoConta(web, conta.accountId, (c) => c.query("select * from alerts where kind = 'incidente_confirmado'"));
    expect(a.rowCount).toBe(1);
    expect(a.rows[0].severity).toBe('alta');
    expect(a.rows[0].state).toBe('aberto');
  });

  it('N01: mais 8 falhas seguidas → ainda UM alerta de abertura, um incidente, 10 checagens falhas', async () => {
    for (let k = 0; k < 8; k++) { avanca(5); await umaRodada(); }
    expect((await admin.query("select count(*)::int as n from alerts where kind = 'incidente_confirmado'")).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from incidents')).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from checks where not ok')).rows[0].n).toBe(10);
    expect((await admin.query('select failed_checks from incidents')).rows[0].failed_checks).toBe(10);
  });

  it('200: recupera, alerta de recuperação, alerta de abertura resolvido, duração observada coerente', async () => {
    avanca(5); proximo = ok;
    await umaRodada();
    const i = await admin.query('select * from incidents where monitor_id = $1', [monitorId]);
    expect(i.rows[0].recovered_at).not.toBeNull();
    expect(i.rows[0].outcome).toBe('confirmado');
    const abertura = await admin.query("select state from alerts where kind = 'incidente_confirmado'");
    expect(abertura.rows[0].state).toBe('resolvido');
    const rec = await admin.query("select details from alerts where kind = 'incidente_recuperado'");
    expect(rec.rowCount).toBe(1);
    // 1ª falha em t+5, recuperação em t+55 → 50 min observados.
    expect(rec.rows[0].details.observedDurationMs).toBe(50 * 60_000);
  });

  it('U02: falha isolada seguida de 200 fecha como isolada, sem alerta novo', async () => {
    avanca(5); proximo = falha; await umaRodada();
    avanca(5); proximo = ok; await umaRodada();
    const i = await admin.query("select outcome, confirmed_at from incidents where monitor_id = $1 order by created_at desc limit 1", [monitorId]);
    expect(i.rows[0].outcome).toBe('isolada');
    expect(i.rows[0].confirmed_at).toBeNull();
    expect((await admin.query("select count(*)::int as n from alerts where kind like 'incidente%'")).rows[0].n).toBe(2);
  });

  it('U03: worker parado por 20 min → ao retomar, registra alerta de atraso já resolvido', async () => {
    avanca(20); proximo = ok; await forcarDevido(); await umaRodada();
    const a = await admin.query("select state, resolved_by from alerts where kind = 'verificacao_atrasada'");
    expect(a.rowCount).toBe(1);
    expect(a.rows[0].state).toBe('resolvido');
    expect(a.rows[0].resolved_by).toBe('worker');
  });

  it('manutenção: checagens e incidentes são registrados, alertas operacionais não', async () => {
    await admin.query('update monitors set maintenance_until = $2 where id = $1', [monitorId, new Date(relogio.getTime() + 3_600_000)]);
    const antes = (await admin.query('select count(*)::int as n from alerts')).rows[0].n;
    for (let k = 0; k < 2; k++) { avanca(5); proximo = falha; await umaRodada(); }
    const i = await admin.query('select confirmed_at from incidents where monitor_id = $1 and recovered_at is null', [monitorId]);
    expect(i.rows[0].confirmed_at).not.toBeNull();
    expect((await admin.query('select count(*)::int as n from alerts')).rows[0].n).toBe(antes);
    await admin.query('update monitors set maintenance_until = null where id = $1', [monitorId]);
    avanca(5); proximo = ok; await umaRodada();
  });
});

describe('U07 — lease', () => {
  it('worker A morre com o lease; B retoma depois do vencimento; a gravação tardia de A é descartada', async () => {
    avanca(5); await forcarDevido();
    const [mA] = await reivindicar(worker, 1, relogio);
    expect(mA).toBeDefined();
    // Enquanto o lease de A vale, B não pega nada.
    expect(await reivindicar(worker, 1, relogio)).toHaveLength(0);
    // Lease de A vence (A morreu): B reivindica.
    const depois = new Date(relogio.getTime() + 120_000);
    const [mB] = await reivindicar(worker, 1, depois);
    expect(mB).toBeDefined();
    expect(mB!.leaseToken).not.toBe(mA!.leaseToken);
    // A volta à vida e tenta gravar: descartado, nada muda.
    const checksAntes = (await admin.query('select count(*)::int as n from checks')).rows[0].n;
    expect(await gravar(worker, mA!, ok, 'A', depois)).toBe(false);
    expect((await admin.query('select count(*)::int as n from checks')).rows[0].n).toBe(checksAntes);
    // B grava normalmente.
    expect(await gravar(worker, mB!, ok, 'B', depois)).toBe(true);
    expect((await admin.query('select count(*)::int as n from checks')).rows[0].n).toBe(checksAntes + 1);
    relogio = depois;
  });

  it('dois workers concorrentes nunca reivindicam o mesmo monitor (SKIP LOCKED)', async () => {
    avanca(5); await forcarDevido();
    const [a, b] = await Promise.all([reivindicar(worker, 5, relogio), reivindicar(worker, 5, relogio)]);
    expect(a.length + b.length).toBe(1);
  });

  it('app_worker não enxerga usuários nem sessões; app_web não grava checagens', async () => {
    await expect(worker.query('select * from users')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from auth_sessions')).rejects.toThrow(/permission denied/);
    await expect(comoConta(web, conta.accountId, (c) => c.query('insert into checks (account_id, monitor_id, site_id, ok) values ($1, $2, $3, true)', [conta.accountId, monitorId, siteId]))).rejects.toThrow(/permission denied/);
  });
});
