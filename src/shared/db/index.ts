import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { configDoPg } from '@/shared/db/tls';

/**
 * Conexões por FINALIDADE, cada uma com o papel de menor privilégio.
 *
 *   DATABASE_URL         → app_web: a central. Enxerga só a conta da sessão (RLS).
 *   DATABASE_URL_WORKER  → app_worker (Fase 2): monitores, checagens, heartbeat.
 *
 * A separação não é decorativa: um erro de código ainda esbarra na negativa do
 * banco. Scripts administrativos usam DATABASE_URL_ADMIN e não passam por aqui.
 */

declare global {
  // Em desenvolvimento o Next recarrega módulos a cada edição; sem este cache
  // cada recarga abriria um pool novo até esgotar as conexões do Postgres.
  var __johnyPools: Map<string, Pool> | undefined;
}

const pools = (globalThis.__johnyPools ??= new Map<string, Pool>());

export { tlsPara } from '@/shared/db/tls';

function poolFor(envVar: string): Pool {
  const existing = pools.get(envVar);
  if (existing) return existing;

  const connectionString = process.env[envVar];
  if (!connectionString) {
    throw new Error(
      `Variável de ambiente ausente: ${envVar}. Em desenvolvimento, copie .env.example para .env.local.`,
    );
  }

  const serverless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  // DB_POOL_MAX: conexões por papel nesta instância (padrão 10; 3 em serverless).
  const maxEnv = Number(process.env.DB_POOL_MAX);
  const pool = new Pool({
    ...configDoPg(connectionString),
    max: Number.isInteger(maxEnv) && maxEnv > 0 ? maxEnv : serverless ? 3 : 10,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (erro) => {
    console.error(`[db] erro em conexão ociosa (${envVar}):`, erro.message);
  });
  pools.set(envVar, pool);
  return pool;
}

export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
};

function wrap(client: PoolClient, contar?: { n: number }): Queryable {
  // Uma transação usa UMA conexão e o driver não aceita duas consultas
  // simultâneas nela. A fila serializa chamadas paralelas em vez de corromper.
  let fila: Promise<unknown> = Promise.resolve();
  const enfileirar = <T>(executar: () => Promise<T>): Promise<T> => {
    const resultado = fila.then(executar, executar);
    fila = resultado.catch(() => undefined);
    return resultado;
  };
  return {
    query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
      if (contar) contar.n += 1;
      return enfileirar(async () => (await client.query<T>(sql, params)).rows);
    },
    one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
      if (contar) contar.n += 1;
      return enfileirar<T | null>(async () => (await client.query<T>(sql, params)).rows[0] ?? null);
    },
  };
}

async function transaction<T>(pool: Pool, accountId: string | null, fn: (db: Queryable) => Promise<T>): Promise<T> {
  // DB_LOG_LENTO_MS: registra transações mais lentas que N ms (0 = todas) com o número de consultas.
  // Diz se a lentidão é rede/banco (muitas consultas × latência) ou CPU. Sem a variável, não faz nada.
  const limiar = process.env.DB_LOG_LENTO_MS === undefined || process.env.DB_LOG_LENTO_MS === '' ? null : Number(process.env.DB_LOG_LENTO_MS);
  const t0 = limiar === null ? 0 : performance.now();
  const contar = limiar === null ? undefined : { n: 0 };
  const client = await pool.connect();
  const espera = limiar === null ? 0 : performance.now() - t0;
  try {
    await client.query('begin');
    if (accountId !== null) {
      // SET LOCAL: vale só até o fim desta transação, nunca vaza entre requisições.
      await client.query("select set_config('app.account_id', $1, true)", [accountId]);
    }
    const result = await fn(wrap(client, contar));
    await client.query('commit');
    if (limiar !== null && Number.isFinite(limiar)) {
      const total = performance.now() - t0;
      if (total >= limiar) console.log(`[db-lento] ${total.toFixed(0)} ms (conexão do pool ${espera.toFixed(0)} ms) · ${contar!.n} consulta(s) · conta=${accountId ? 'sim' : 'não'}`);
    }
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Consultas da central no escopo de uma conta. Toda leitura do produto passa
 * por aqui: a RLS transforma um id de outra conta em "nenhuma linha".
 */
export function comConta<T>(accountId: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
  return transaction(poolFor('DATABASE_URL'), accountId, fn);
}

/** Antes do login (buscar usuário por e-mail, validar sessão). Sem conta ainda. */
export function semConta<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  return transaction(poolFor('DATABASE_URL'), null, fn);
}

/** Endpoint público de eventos. Papel app_ingest: sessões e eventos, nada mais. */
export function comIngestao<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  return transaction(poolFor('DATABASE_URL_INGEST'), null, fn);
}

/** Endpoint público de formulários. Papel app_forms: submissões e contatos. */
export function comFormularios<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  return transaction(poolFor('DATABASE_URL_FORMS'), null, fn);
}

/** Verifica se o banco responde. Usado pela tela de Configurações, nunca em render crítico. */
export async function verificarBanco(): Promise<{ ok: true; papel: string } | { ok: false; erro: string }> {
  try {
    const r = await poolFor('DATABASE_URL').query<{ papel: string }>('select current_user as papel');
    return { ok: true, papel: r.rows[0]!.papel };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
