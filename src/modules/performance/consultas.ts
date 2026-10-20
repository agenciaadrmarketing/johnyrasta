import 'server-only';
import { comConta } from '@/shared/db';
import type { Diagnostico, Dispositivo } from '@/modules/performance/pagespeed';

export type UrlMonitorada = { id: string; url: string; priority: number; devices: Dispositivo[]; frequency: 'diaria' | 'manual'; enabled: boolean; createdAt: Date };

export type Medicao = {
  id: string;
  monitoredUrlId: string;
  url: string;
  device: Dispositivo;
  measuredAt: Date;
  status: 'ok' | 'parcial' | 'erro';
  errorCategory: string | null;
  errorDetail: string | null;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  diagnostics: Diagnostico[];
  lighthouseVersion: string | null;
  regression: boolean;
};

export type Crux = { scope: 'url' | 'origin'; identifier: string; device: Dispositivo; collectedAt: Date; overall: string | null; lcpP75Ms: number | null; inpP75Ms: number | null; clsP75: number | null };

export type TrabalhoPendente = { monitoredUrlId: string; device: Dispositivo; state: string; attempts: number; runAfter: Date; errorCategory: string | null; lastError: string | null };

export const ROTULO_ERRO_PS: Record<string, string> = {
  sem_chave: 'Chave do Google não configurada',
  cota: 'Cota da API excedida',
  timeout: 'A API não respondeu no prazo',
  pagina_inacessivel: 'Página inacessível para o Lighthouse',
  resposta_parcial: 'Resposta parcial',
  resposta_invalida: 'Resposta inválida',
  bloqueado: 'Pedido recusado pela API',
  desconhecido: 'Falha não classificada',
};

const SELECT_RUN = `select id, monitored_url_id as "monitoredUrlId", url, device, measured_at as "measuredAt", status, error_category as "errorCategory", error_detail as "errorDetail",
  performance, accessibility, best_practices as "bestPractices", seo, lcp_ms as "lcpMs", cls::float as cls, tbt_ms as "tbtMs", diagnostics, lighthouse_version as "lighthouseVersion", regression
  from performance_runs`;

export async function urlsDoSite(accountId: string, siteId: string): Promise<UrlMonitorada[]> {
  return comConta(accountId, (db) =>
    db.query<UrlMonitorada>(`select id, url, priority, devices, frequency, enabled, created_at as "createdAt" from monitored_urls where site_id = $1 and archived_at is null order by priority, created_at`, [siteId]),
  );
}

/** Última medição por URL × dispositivo, mais a última OK (para comparação). */
export async function ultimasMedicoes(accountId: string, siteId: string): Promise<Medicao[]> {
  return comConta(accountId, (db) =>
    db.query<Medicao>(`${SELECT_RUN} where id in (select distinct on (monitored_url_id, device) id from performance_runs where site_id = $1 order by monitored_url_id, device, measured_at desc) order by url, device`, [siteId]),
  );
}

export async function historicoDeMedicoes(accountId: string, siteId: string, limite = 60): Promise<Medicao[]> {
  return comConta(accountId, (db) => db.query<Medicao>(`${SELECT_RUN} where site_id = $1 order by measured_at desc limit $2`, [siteId, limite]));
}

export async function ultimoCrux(accountId: string, siteId: string): Promise<Crux[]> {
  return comConta(accountId, (db) =>
    db.query<Crux>(
      `select distinct on (identifier, scope, device) scope, identifier, device, collected_at as "collectedAt", overall, lcp_p75_ms as "lcpP75Ms", inp_p75_ms as "inpP75Ms", cls_p75::float as "clsP75"
         from crux_snapshots where site_id = $1 order by identifier, scope, device, collected_at desc`,
      [siteId],
    ),
  );
}

export async function trabalhosPendentes(accountId: string, siteId: string): Promise<TrabalhoPendente[]> {
  return comConta(accountId, (db) =>
    db.query<TrabalhoPendente>(
      `select payload->>'monitoredUrlId' as "monitoredUrlId", payload->>'device' as device, state, attempts, run_after as "runAfter", error_category as "errorCategory", last_error as "lastError"
         from audit_jobs where site_id = $1 and kind = 'pagespeed' and state in ('pendente', 'processando') order by run_after`,
      [siteId],
    ),
  );
}

export type EstadoPageSpeed = { configurado: boolean; urls: number; pendentes: number; processando: number; atrasados: number; medicoes24h: number; falhas24h: number };

export async function estadoPageSpeed(accountId: string): Promise<EstadoPageSpeed> {
  const r = await comConta(accountId, (db) =>
    db.one<Omit<EstadoPageSpeed, 'configurado'>>(
      `select (select count(*)::int from monitored_urls where enabled and archived_at is null) as urls,
              (select count(*)::int from audit_jobs where kind = 'pagespeed' and state = 'pendente') as pendentes,
              (select count(*)::int from audit_jobs where kind = 'pagespeed' and state = 'processando') as processando,
              (select count(*)::int from audit_jobs where kind = 'pagespeed' and state = 'pendente' and run_after < now() - interval '2 hours') as atrasados,
              (select count(*)::int from performance_runs where measured_at > now() - interval '24 hours' and status <> 'erro') as "medicoes24h",
              (select count(*)::int from performance_runs where measured_at > now() - interval '24 hours' and status = 'erro') as "falhas24h"`,
    ),
  );
  return { configurado: !!process.env.PAGESPEED_API_KEY, urls: 0, pendentes: 0, processando: 0, atrasados: 0, medicoes24h: 0, falhas24h: 0, ...r };
}
