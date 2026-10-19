/**
 * Worker do JohnyWeb — processo separado da aplicação web.
 *
 *   npm run worker
 *
 * Laço: reivindica monitores devidos (fila com lease no Postgres), verifica
 * com o verificador seguro, aplica a máquina de estados, grava, agenda a
 * próxima checagem. Heartbeat a cada 30 s; retenção a cada hora. Nada aqui
 * depende de uma aba aberta nem de visitas à central.
 *
 * Papel do banco: app_worker (DATABASE_URL_WORKER). Sem acesso a usuários,
 * sessões ou contatos.
 *
 * Variáveis:
 *   WORKER_ID                     identificador desta instância
 *   MONITOR_CONCORRENCIA          checagens simultâneas (padrão 5)
 *   MONITOR_EXCECOES_DE_REDE      IPs privados permitidos, separados por vírgula (NUNCA em produção aberta)
 */
import { Pool } from 'pg';
import { hostname } from 'node:os';
import { loadEnv } from '../scripts/env';
import { rodada, retencao } from './rodada';

loadEnv();

const url = process.env.DATABASE_URL_WORKER;
if (!url) {
  console.error('[worker] Defina DATABASE_URL_WORKER (papel app_worker). Veja .env.example.');
  process.exit(1);
}

const WORKER_ID = process.env.WORKER_ID ?? `${hostname()}-${process.pid}`;
const VERSAO = `v2-fase2`;
const TICK_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const RETENCAO_MS = 60 * 60 * 1000;
const CONCORRENCIA = Number(process.env.MONITOR_CONCORRENCIA ?? 5);
const EXCECOES = (process.env.MONITOR_EXCECOES_DE_REDE ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const pool = new Pool({ connectionString: url, max: CONCORRENCIA + 2 });

async function heartbeat(detalhes: Record<string, unknown>): Promise<void> {
  await pool.query(
    `insert into worker_heartbeats (worker_id, seen_at, version, details)
     values ($1, now(), $2, $3)
     on conflict (worker_id) do update set seen_at = now(), version = excluded.version, details = excluded.details`,
    [WORKER_ID, VERSAO, JSON.stringify(detalhes)],
  );
}

async function estadoDaFila() {
  const r = await pool.query<{ devidos: number; atrasados: number; mais_antigo_s: number | null }>(
    `select count(*) filter (where next_check_at <= now())::int as devidos,
            count(*) filter (where next_check_at < now() - make_interval(secs => interval_seconds * 3))::int as atrasados,
            extract(epoch from now() - min(next_check_at))::int as mais_antigo_s
       from monitors where enabled`,
  );
  return r.rows[0]!;
}

let encerrando = false;
let ultimoHeartbeat = 0;
let ultimaRetencao = 0;
let acumulado = { reivindicados: 0, gravados: 0, descartados: 0, erros: 0 };

async function loop() {
  console.log(`[worker] ${WORKER_ID} iniciado. Concorrência ${CONCORRENCIA}. Exceções de rede: ${EXCECOES.length ? EXCECOES.join(', ') : 'nenhuma'}.`);
  if (EXCECOES.length) console.warn('[worker] ATENÇÃO: há IPs privados liberados. Não use isto numa instalação aberta.');
  while (!encerrando) {
    const inicio = Date.now();
    try {
      const r = await rodada(pool, { workerId: WORKER_ID, concorrencia: CONCORRENCIA, verificador: { excecoesDeRede: EXCECOES } });
      acumulado = { reivindicados: acumulado.reivindicados + r.reivindicados, gravados: acumulado.gravados + r.gravados, descartados: acumulado.descartados + r.descartados, erros: acumulado.erros + r.erros };
      if (r.reivindicados) console.log(`[worker] rodada: ${r.gravados} gravadas, ${r.descartados} descartadas (lease perdido), ${r.erros} erros`);
    } catch (e) {
      console.error('[worker] rodada falhou:', e instanceof Error ? e.message : e);
    }
    if (Date.now() - ultimoHeartbeat > HEARTBEAT_MS) {
      try {
        const fila = await estadoDaFila();
        await heartbeat({ fase: 2, fila, acumulado, concorrencia: CONCORRENCIA });
        ultimoHeartbeat = Date.now();
      } catch (e) {
        console.error('[worker] heartbeat falhou:', e instanceof Error ? e.message : e);
      }
    }
    if (Date.now() - ultimaRetencao > RETENCAO_MS) {
      try {
        const n = await retencao(pool);
        if (n) console.log(`[worker] retenção: ${n} checagens antigas apagadas`);
        ultimaRetencao = Date.now();
      } catch (e) {
        console.error('[worker] retenção falhou:', e instanceof Error ? e.message : e);
      }
    }
    const espera = Math.max(250, TICK_MS - (Date.now() - inicio));
    await new Promise((r) => setTimeout(r, espera));
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
