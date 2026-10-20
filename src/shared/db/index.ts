import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

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

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/**
 * TLS: obrigatório fora de hosts locais. Com `DATABASE_SSL_CA` a cadeia é
 * verificada; sem ela a conexão é cifrada mas não autenticada (protege contra
 * escuta passiva, não contra intermediário ativo).
 */
export function tlsPara(connectionString: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const ca = process.env.DATABASE_SSL_CA;
  const remoto = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // Formato que não é URL: não dá para saber se é local. Falhar FECHADO.
    return remoto;
  }
  return HOSTS_LOCAIS.has(host) ? false : remoto;
}

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
  const pool = new Pool({
    connectionString,
    ssl: tlsPara(connectionString),
    max: serverless ? 3 : 10,
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

function wrap(client: PoolClient): Queryable {
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
      return enfileirar(async () => (await client.query<T>(sql, params)).rows);
    },
    one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
      return enfileirar<T | null>(async () => (await client.query<T>(sql, params)).rows[0] ?? null);
    },
  };
}

async function transaction<T>(pool: Pool, accountId: string | null, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (accountId !== null) {
      // SET LOCAL: vale só até o fim desta transação, nunca vaza entre requisições.
      await client.query("select set_config('app.account_id', $1, true)", [accountId]);
    }
    const result = await fn(wrap(client));
    await client.query('commit');
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
