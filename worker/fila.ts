/**
 * Fila de monitores no Postgres, com lease.
 *
 * `reivindicar` pega os monitores devidos (ou cujo lease venceu — worker que
 * morreu no meio, U07) com FOR UPDATE SKIP LOCKED e carimba um token. Toda
 * gravação posterior confere o token: se outro worker retomou, a gravação
 * antiga não acontece.
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { EstadoDoMonitor } from '@/modules/monitoring/transicao';

export type MonitorReivindicado = EstadoDoMonitor & {
  accountId: string;
  url: string;
  leaseToken: string;
  nextCheckAt: Date | null;
  manualRequestedAt: Date | null;
};

export const LEASE_SEGUNDOS = 90;

export async function reivindicar(pool: Pool, limite: number, agora: Date = new Date()): Promise<MonitorReivindicado[]> {
  const token = randomUUID();
  const r = await pool.query<{
    id: string; account_id: string; site_id: string; site_nome: string; url: string; interval_seconds: number;
    consecutive_failures: number; last_failure_at: Date | null; last_check_at: Date | null; maintenance_until: Date | null;
    tls_expires_at: Date | null; next_check_at: Date | null; manual_requested_at: Date | null;
    inc_id: string | null; inc_confirmed_at: Date | null; inc_first: Date | null; inc_failed: number | null;
  }>(
    `with devidos as (
       select m.id from monitors m
        where m.enabled
          and (m.next_check_at is null or m.next_check_at <= $1)
          and (m.lease_token is null or m.lease_until < $1)
        order by m.next_check_at nulls first
        limit $2
        for update skip locked
     ), marcados as (
       update monitors m set lease_token = $3, lease_until = $1::timestamptz + make_interval(secs => $4)
         from devidos d where m.id = d.id
       returning m.*
     )
     select m.id, m.account_id, m.site_id, s.name as site_nome, m.url, m.interval_seconds, m.consecutive_failures,
            m.last_failure_at, m.last_check_at, m.maintenance_until, m.tls_expires_at, m.next_check_at, m.manual_requested_at,
            i.id as inc_id, i.confirmed_at as inc_confirmed_at, i.first_failure_at as inc_first, i.failed_checks as inc_failed
       from marcados m
       join sites s on s.id = m.site_id
       left join incidents i on i.monitor_id = m.id and i.recovered_at is null`,
    [agora, limite, token, LEASE_SEGUNDOS],
  );
  return r.rows.map((x) => ({
    id: x.id,
    accountId: x.account_id,
    siteId: x.site_id,
    siteNome: x.site_nome,
    url: x.url,
    intervalSeconds: x.interval_seconds,
    consecutiveFailures: x.consecutive_failures,
    lastFailureAt: x.last_failure_at,
    lastCheckAt: x.last_check_at,
    emManutencao: !!x.maintenance_until && x.maintenance_until > agora,
    tlsExpiresAt: x.tls_expires_at,
    incidenteAberto: x.inc_id ? { id: x.inc_id, confirmado: x.inc_confirmed_at !== null, firstFailureAt: x.inc_first!, failedChecks: x.inc_failed ?? 1 } : null,
    leaseToken: token,
    nextCheckAt: x.next_check_at,
    manualRequestedAt: x.manual_requested_at,
  }));
}

/** Libera o lease sem gravar resultado (falha interna do worker). O monitor volta à fila. */
export async function liberar(pool: Pool, monitorId: string, token: string): Promise<void> {
  await pool.query('update monitors set lease_token = null, lease_until = null where id = $1 and lease_token = $2', [monitorId, token]);
}

/** Confere que o lease ainda é nosso dentro da transação de gravação. */
export async function leaseAindaMeu(c: PoolClient, monitorId: string, token: string): Promise<boolean> {
  const r = await c.query('select 1 from monitors where id = $1 and lease_token = $2 for update', [monitorId, token]);
  return (r.rowCount ?? 0) > 0;
}
