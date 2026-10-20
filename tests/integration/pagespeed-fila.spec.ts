import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { comoConta, criarConta, prepararBanco, urls } from './apoio';
import { agendarDiarios, reivindicarTrabalhos, rodadaPageSpeed } from '../../worker/pagespeed';

let admin: Client; let web: Pool; let worker: Pool;
let conta: { accountId: string; userId: string };
let urlId: string;
let relogio = new Date('2026-10-19T10:00:00Z');
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, 'utf8'));
const respostas: Array<{ status: number; corpo: unknown }> = [];
const fetchFalso = (async () => {
  const r = respostas.shift() ?? { status: 500, corpo: {} };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo } as Response;
}) as typeof fetch;
const rodar = () => rodadaPageSpeed(worker, { chave: 'K', fetch: fetchFalso, workerId: 't', concorrencia: 4, agora: () => relogio });

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  const wu = new URL(process.env.DATABASE_URL_WORKER!); wu.pathname = '/johnyweb_test';
  worker = new Pool({ connectionString: wu.toString(), max: 6 });
  conta = await criarConta(admin, 'Conta PS');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const s = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'S', 'exemplo.com.br', 'https://www.exemplo.com.br/', 'pubPS') returning id`, [conta.accountId, c.rows[0]!.id]);
  const m = await admin.query<{ id: string }>(`insert into monitored_urls (account_id, site_id, url) values ($1, $2, 'https://www.exemplo.com.br/') returning id`, [conta.accountId, s.rows[0]!.id]);
  urlId = m.rows[0]!.id;
});
afterAll(async () => { await worker.end(); await web.end(); await admin.end(); });

describe('fila do PageSpeed', () => {
  it('sem chave, a rodada não reivindica nada (X01)', async () => {
    await agendarDiarios(worker, relogio);
    const r = await rodadaPageSpeed(worker, { chave: null, workerId: 't', fetch: fetchFalso, agora: () => relogio });
    expect(r.reivindicados).toBe(0);
  });
  it('P02: agenda diária cria uma série por dispositivo, idempotente no mesmo dia', async () => {
    expect(await agendarDiarios(worker, relogio)).toBe(0); // já agendados acima
    const j = await admin.query("select payload->>'device' as d from audit_jobs order by 1");
    expect(j.rows.map((x) => x.d)).toEqual(['desktop', 'mobile']);
  });
  it('P01: 429 vira retentativa com backoff e NÃO grava nota; depois mede os dois', async () => {
    respostas.push({ status: 429, corpo: { error: { message: 'Quota exceeded' } } }, { status: 429, corpo: {} });
    const r1 = await rodar();
    expect(r1).toMatchObject({ reivindicados: 2, retentativas: 2, medidos: 0 });
    expect((await admin.query('select count(*)::int as n from performance_runs')).rows[0].n).toBe(0);
    const pend = await admin.query("select state, run_after, error_category from audit_jobs");
    expect(pend.rows.every((x) => x.state === 'pendente' && x.error_category === 'cota' && new Date(x.run_after) > relogio)).toBe(true);
    // Ainda não é hora: nada reivindicado.
    expect((await rodar()).reivindicados).toBe(0);
    relogio = new Date(relogio.getTime() + 10 * 60_000);
    respostas.push({ status: 200, corpo: fx('psi-completo') }, { status: 200, corpo: fx('psi-parcial') });
    const r2 = await rodar();
    expect(r2.medidos).toBe(2);
    const runs = await comoConta(web, conta.accountId, (c) => c.query('select device, status, performance, accessibility from performance_runs order by device'));
    expect(runs.rowCount).toBe(2);
    expect(runs.rows.map((x) => x.device)).toEqual(['desktop', 'mobile']);
    expect(runs.rows.some((x) => x.status === 'parcial' && x.accessibility === null)).toBe(true);
  });
  it('P03: CrUX só para a resposta que tinha campo; a parcial fica sem snapshot (insuficiente, não zero)', async () => {
    const c = await admin.query('select device, scope, inp_p75_ms from crux_snapshots');
    expect(c.rowCount).toBe(1);
    expect(c.rows[0].inp_p75_ms).toBe(180);
  });
  it('medição de hoje concluída: nova agenda do mesmo dia não repete; novo dia agenda de novo', async () => {
    expect(await agendarDiarios(worker, relogio)).toBe(0);
    const amanha = new Date('2026-10-20T10:00:00Z');
    expect(await agendarDiarios(worker, amanha)).toBe(2);
  });
  it('regressão: queda de 72 → 50 marca possível regressão; página inacessível falha de vez com estado próprio', async () => {
    relogio = new Date('2026-10-20T10:05:00Z');
    const baixo = fx('psi-completo'); baixo.lighthouseResult.categories.performance.score = 0.5;
    respostas.push({ status: 200, corpo: baixo }, { status: 200, corpo: baixo });
    const r = await rodar();
    expect(r.medidos).toBe(2);
    // Só a série que tinha medição OK anterior (72) é comparável; a que só tinha parcial não.
    const reg = await admin.query("select device, regression from performance_runs where performance = 50 order by device");
    const comparavel = (await admin.query("select device from performance_runs where performance = 72")).rows[0].device;
    expect(reg.rows.find((x) => x.device === comparavel).regression).toBe(true);
    expect(reg.rows.find((x) => x.device !== comparavel).regression).toBe(false);
    // Página inacessível: falha de vez, estado próprio, sem nota.
    await agendarDiarios(worker, new Date('2026-10-22T10:00:00Z'));
    relogio = new Date('2026-10-22T10:00:00Z');
    respostas.push({ status: 500, corpo: { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } } }, { status: 500, corpo: { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } } });
    expect((await rodar()).falhas).toBe(2);
    const err = await admin.query("select error_category, performance from performance_runs where status = 'erro' limit 1");
    expect(err.rows[0]).toEqual({ error_category: 'pagina_inacessivel', performance: null });
  });
  it('lease: trabalho preso em processando é retomado após o vencimento; o antigo não grava', async () => {
    await agendarDiarios(worker, new Date('2026-10-21T10:00:00Z'));
    const t = new Date('2026-10-21T10:00:00Z');
    const [a] = await reivindicarTrabalhos(worker, 1, t);
    expect(a).toBeDefined();
    expect(await reivindicarTrabalhos(worker, 1, t)).toHaveLength(1); // o outro dispositivo
    expect(await reivindicarTrabalhos(worker, 1, t)).toHaveLength(0);
    const depois = new Date(t.getTime() + 200_000);
    const retomados = await reivindicarTrabalhos(worker, 5, depois);
    expect(retomados.length).toBe(2);
    expect(retomados.every((j) => j.token !== a!.token)).toBe(true);
  });
  it('app_web não insere medições; app_worker não enxerga usuários', async () => {
    await expect(comoConta(web, conta.accountId, (c) => c.query("insert into performance_runs (account_id, site_id, monitored_url_id, url, device, status) values ($1, (select site_id from monitored_urls limit 1), $2, 'x', 'mobile', 'ok')", [conta.accountId, urlId]))).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from users')).rejects.toThrow(/permission denied/);
  });
});
