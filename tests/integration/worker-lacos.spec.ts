import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, criarConta, prepararBanco, urls } from './apoio';
import { iniciarAgendador } from '../../worker/agendador';
import { rodada } from '../../worker/rodada';
import { agendarDiarios, rodadaPageSpeed } from '../../worker/pagespeed';
import type { ResultadoDaChecagem } from '@/modules/monitoring/transicao';

/**
 * Achado 4: uma chamada lenta ao PageSpeed não pode parar a disponibilidade nem
 * o heartbeat. Banco real, PageSpeed com `fetch` que fica PENDENTE até o teste liberar.
 */
let admin: Client; let worker: Pool; let siteId: string; let accountId: string;
const ok: ResultadoDaChecagem = { ok: true, httpStatus: 200, durationMs: 50, errorCategory: null, errorDetail: null, finalUrl: 'https://lento.exemplo.com/', redirects: 0, tlsExpiresAt: new Date('2027-06-01T00:00:00Z'), tlsState: 'valido' };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(cond: () => Promise<boolean> | boolean, ms = 4000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return true; await esperar(25); }
  return false;
}

beforeAll(async () => {
  await prepararBanco();
  admin = new Client({ connectionString: urls().admin }); await admin.connect();
  const wu = new URL(process.env.DATABASE_URL_WORKER!); wu.pathname = `/${BANCO_TESTE}`;
  worker = new Pool({ connectionString: wu.toString(), max: 10 });
  const conta = await criarConta(admin, 'Conta Laços');
  accountId = conta.accountId;
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [accountId, 'C']);
  const s = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Lento', 'lento.exemplo.com', 'https://lento.exemplo.com/', 'pubLaco') returning id`, [accountId, c.rows[0]!.id]);
  siteId = s.rows[0]!.id;
  await admin.query('insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, now())', [accountId, siteId, 'https://lento.exemplo.com/']);
  await admin.query(`insert into monitored_urls (account_id, site_id, url) values ($1, $2, 'https://lento.exemplo.com/')`, [accountId, siteId]);
});
afterAll(async () => { await worker.end(); await admin.end(); });

describe('laços do worker', () => {
  it('PageSpeed pendente: o monitor devido é checado e o heartbeat continua antes de a resposta ser liberada', async () => {
    await agendarDiarios(worker, new Date());
    let liberarPs!: () => void;
    const respostaPs = new Promise<Response>((r) => { liberarPs = () => r({ ok: false, status: 500, json: async () => ({}) } as Response); });
    let psIniciou = false;
    let batidas = 0;
    const agendador = iniciarAgendador([
      { nome: 'pagespeed', intervaloMs: 40, executar: async () => { await rodadaPageSpeed(worker, { chave: 'K', workerId: 't', fetch: (async () => { psIniciou = true; return respostaPs; }) as typeof fetch }); } },
      { nome: 'disponibilidade', intervaloMs: 40, executar: async () => { await rodada(worker, { workerId: 't', verificar: async () => ok }); } },
      { nome: 'heartbeat', intervaloMs: 40, executar: async () => { batidas += 1; await worker.query(`insert into worker_heartbeats (worker_id, seen_at, version, details) values ('t-laco', now(), 'teste', '{}') on conflict (worker_id) do update set seen_at = now()`); } },
    ], { aoErro: (n, e) => { throw new Error(`${n}: ${String(e)}`); } });
    try {
      expect(await ate(() => psIniciou)).toBe(true); // a chamada lenta está em andamento
      expect(await ate(async () => (await admin.query('select count(*)::int as n from checks where site_id = $1', [siteId])).rows[0].n >= 1)).toBe(true);
      const antes = batidas;
      expect(await ate(() => batidas >= antes + 3)).toBe(true); // heartbeat segue batendo
      const hb = (await admin.query("select seen_at from worker_heartbeats where worker_id = 't-laco'")).rows[0];
      expect(Date.now() - new Date(hb.seen_at).getTime()).toBeLessThan(2000);
      // Ainda sem resposta do PageSpeed: nenhuma medição concluída nem falha gravada.
      expect((await admin.query("select count(*)::int as n from audit_jobs where state in ('falhou','concluido')")).rows[0].n).toBe(0);
    } finally {
      liberarPs();
      await agendador.parar();
    }
  });
});
