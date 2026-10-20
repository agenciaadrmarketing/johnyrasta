import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { BANCO_TESTE, criarConta, prepararBanco, urls } from './apoio';
import { agendarDiarios, rodadaPageSpeed } from '../../worker/pagespeed';

let admin: Client; let worker: Pool;
const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, 'utf8'));
let dia = 0;

async function medirNoDia(nota: number) {
  dia += 1;
  const agora = new Date(Date.UTC(2026, 9, dia, 10, 0, 0));
  const corpo = fx('psi-completo');
  corpo.lighthouseResult.categories.performance.score = nota;
  const f = (async () => ({ ok: true, status: 200, json: async () => corpo }) as Response) as typeof fetch;
  await agendarDiarios(worker, agora);
  await rodadaPageSpeed(worker, { chave: 'K', fetch: f, workerId: 't', concorrencia: 4, agora: () => agora });
}
const alertas = () => admin.query("select state, details, dedupe_key from alerts where kind = 'regressao_pagespeed' order by created_at, dedupe_key");

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  const wu = new URL(process.env.DATABASE_URL_WORKER!); wu.pathname = `/${BANCO_TESTE}`;
  worker = new Pool({ connectionString: wu.toString(), max: 6 });
  const conta = await criarConta(admin, 'Conta Regressão');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const s = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'S', 'exemplo.com.br', 'https://www.exemplo.com.br/', 'pubRG') returning id`, [conta.accountId, c.rows[0]!.id]);
  await admin.query(`insert into monitored_urls (account_id, site_id, url) values ($1, $2, 'https://www.exemplo.com.br/')`, [conta.accountId, s.rows[0]!.id]);
});
afterAll(async () => { await worker.end(); await admin.end(); });

describe('regressão de PageSpeed confirmada', () => {
  it('queda isolada não alerta; a segunda medição baixa seguida alerta, uma vez por série; a volta resolve', async () => {
    await medirNoDia(0.8); await medirNoDia(0.8);
    await medirNoDia(0.5); // primeira queda: só "possível"
    expect((await alertas()).rowCount).toBe(0);
    await medirNoDia(0.5); // confirmada
    const a = await alertas();
    expect(a.rowCount).toBe(2); // mobile e desktop
    expect(a.rows.every((x) => x.state === 'aberto' && x.details.basePerformance === 80 && x.details.atualPerformance === 50)).toBe(true);
    await medirNoDia(0.5); // continua baixa: nada novo
    expect((await alertas()).rowCount).toBe(2);
    await medirNoDia(0.78); // voltou
    expect((await alertas()).rows.every((x) => x.state === 'resolvido')).toBe(true);
  });
});
