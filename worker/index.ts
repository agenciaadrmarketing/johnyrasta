/**
 * Worker do JohnyWeb — processo separado da aplicação web.
 *
 * Fase 1: só o HEARTBEAT, para a central mostrar com honestidade se existe um
 * worker em execução. A agenda, a fila com leases, o verificador HTTP seguro
 * (anti-SSRF), incidentes e TLS entram na Fase 2 neste mesmo processo.
 *
 * Papel do banco: app_worker (DATABASE_URL_WORKER). Sem acesso a usuários,
 * sessões ou contatos.
 *
 *   npm run worker
 */
import { Pool } from 'pg';
import { hostname } from 'node:os';
import { loadEnv } from '../scripts/env';

loadEnv();

const url = process.env.DATABASE_URL_WORKER;
if (!url) {
  console.error('[worker] Defina DATABASE_URL_WORKER (papel app_worker). Veja .env.example.');
  process.exit(1);
}

const WORKER_ID = process.env.WORKER_ID ?? `${hostname()}-${process.pid}`;
const VERSAO = process.env.npm_package_version ?? 'dev';
const INTERVALO_HEARTBEAT_MS = 30_000;

const pool = new Pool({ connectionString: url, max: 2 });

async function heartbeat(detalhes: Record<string, unknown> = {}): Promise<void> {
  await pool.query(
    `insert into worker_heartbeats (worker_id, seen_at, version, details)
     values ($1, now(), $2, $3)
     on conflict (worker_id) do update set seen_at = now(), version = excluded.version, details = excluded.details`,
    [WORKER_ID, VERSAO, JSON.stringify(detalhes)],
  );
}

let encerrando = false;
async function loop() {
  console.log(`[worker] ${WORKER_ID} iniciado. Fase 1: heartbeat a cada ${INTERVALO_HEARTBEAT_MS / 1000}s. Verificações HTTP chegam na Fase 2.`);
  while (!encerrando) {
    try {
      const devidos = await pool.query<{ n: number }>('select count(*)::int as n from monitors where enabled and next_check_at <= now()');
      await heartbeat({ fase: 1, monitoresDevidos: devidos.rows[0]?.n ?? 0, capacidade: 'heartbeat apenas' });
    } catch (e) {
      console.error('[worker] heartbeat falhou:', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, INTERVALO_HEARTBEAT_MS));
  }
  await pool.end();
  console.log('[worker] encerrado.');
}

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    encerrando = true;
  });
}

loop().catch((e) => {
  console.error('[worker] falha fatal:', e);
  process.exit(1);
});
