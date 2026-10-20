import 'server-only';
import { comConta } from '@/shared/db';

export type Checagem = {
  id: number;
  checkedAt: Date;
  ok: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  errorCategory: string | null;
  errorDetail: string | null;
  finalUrl: string | null;
  redirects: number;
  tlsExpiresAt: Date | null;
};

export type Incidente = {
  id: string;
  firstFailureAt: Date;
  confirmedAt: Date | null;
  recoveredAt: Date | null;
  outcome: 'isolada' | 'confirmado' | null;
  causeCategory: string | null;
  causeDetail: string | null;
  failedChecks: number;
};

export type AlertaAberto = {
  id: string;
  siteId: string | null;
  siteNome: string | null;
  kind: string;
  severity: 'alta' | 'media' | 'baixa';
  title: string;
  details: Record<string, unknown>;
  state: 'aberto' | 'resolvido' | 'silenciado';
  createdAt: Date;
  resolvedAt: Date | null;
};

export const ROTULO_CATEGORIA: Record<string, string> = {
  dns: 'DNS não resolve',
  bloqueado: 'Destino bloqueado pela política de rede',
  conexao: 'Conexão recusada ou interrompida',
  timeout: 'Sem resposta no prazo',
  tls: 'Falha no certificado TLS',
  http: 'Resposta HTTP de erro',
  redirecionamentos: 'Redirecionamentos em excesso',
  tamanho: 'Resposta grande demais',
  desconhecido: 'Erro não classificado',
};

export const ROTULO_ALERTA: Record<string, string> = {
  incidente_confirmado: 'Indisponível para o monitor',
  incidente_recuperado: 'Recuperado',
  verificacao_atrasada: 'Verificação ficou atrasada',
  tls_vencendo: 'Certificado próximo do vencimento',
  tls_falha: 'Falha no certificado TLS',
  coletor_parado: 'Coleta interrompida',
  fila_parada: 'Fila de medições parada',
  regressao_pagespeed: 'Regressão de velocidade confirmada',
};

export async function ultimasChecagens(accountId: string, siteId: string, limite = 50): Promise<Checagem[]> {
  return comConta(accountId, (db) =>
    db.query<Checagem>(
      `select id, checked_at as "checkedAt", ok, http_status as "httpStatus", duration_ms as "durationMs",
              error_category as "errorCategory", error_detail as "errorDetail", final_url as "finalUrl", redirects,
              tls_expires_at as "tlsExpiresAt"
         from checks where site_id = $1 order by checked_at desc limit $2`,
      [siteId, limite],
    ),
  );
}

export async function incidentesDoSite(accountId: string, siteId: string, limite = 30): Promise<Incidente[]> {
  return comConta(accountId, (db) =>
    db.query<Incidente>(
      `select id, first_failure_at as "firstFailureAt", confirmed_at as "confirmedAt", recovered_at as "recoveredAt",
              outcome, cause_category as "causeCategory", cause_detail as "causeDetail", failed_checks as "failedChecks"
         from incidents where site_id = $1 order by first_failure_at desc limit $2`,
      [siteId, limite],
    ),
  );
}

/** Incidentes que TOCAM o período (recorte no SQL, para o limite não esconder os antigos). */
export async function incidentesNoIntervalo(accountId: string, siteId: string, de: Date, ate: Date, limite = 500): Promise<Incidente[]> {
  return comConta(accountId, (db) =>
    db.query<Incidente>(
      `select id, first_failure_at as "firstFailureAt", confirmed_at as "confirmedAt", recovered_at as "recoveredAt",
              outcome, cause_category as "causeCategory", cause_detail as "causeDetail", failed_checks as "failedChecks"
         from incidents where site_id = $1 and first_failure_at <= $3 and (recovered_at is null or recovered_at >= $2)
        order by first_failure_at desc limit $4`,
      [siteId, de, ate, limite],
    ),
  );
}

export type ResumoDeChecagens = {
  janelaHoras: number;
  amostras: number;
  bemSucedidas: number;
  /** Lacunas maiores que 3 intervalos dentro da janela: cobertura NÃO foi contínua. */
  lacunas: number;
  percentual: number | null;
};

/**
 * "Checagens bem-sucedidas no período", com amostras e lacunas. Não é
 * disponibilidade contínua: é a fração das amostras que respondeu.
 */
export async function resumoDeChecagens(accountId: string, siteId: string, janelaHoras: number): Promise<ResumoDeChecagens> {
  const r = await comConta(accountId, (db) =>
    db.one<{ amostras: number; ok: number; lacunas: number }>(
      `with c as (
         select checked_at, ok,
                checked_at - lag(checked_at) over (order by checked_at) as intervalo
           from checks where site_id = $1 and checked_at > now() - make_interval(hours => $2)
       ), m as (select coalesce((select interval_seconds from monitors where site_id = $1), 300) as seg)
       select count(*)::int as amostras,
              count(*) filter (where ok)::int as ok,
              count(*) filter (where intervalo > make_interval(secs => (select seg from m) * 3))::int as lacunas
         from c`,
      [siteId, janelaHoras],
    ),
  );
  const amostras = r?.amostras ?? 0;
  const ok = r?.ok ?? 0;
  return { janelaHoras, amostras, bemSucedidas: ok, lacunas: r?.lacunas ?? 0, percentual: amostras ? (ok / amostras) * 100 : null };
}

export async function alertasAbertos(accountId: string, opcoes: { siteId?: string; limite?: number } = {}): Promise<AlertaAberto[]> {
  return comConta(accountId, (db) =>
    db.query<AlertaAberto>(
      `select a.id, a.site_id as "siteId", s.name as "siteNome", a.kind, a.severity, a.title, a.details, a.state,
              a.created_at as "createdAt", a.resolved_at as "resolvedAt"
         from alerts a left join sites s on s.id = a.site_id
        where a.state = 'aberto' and ($1::uuid is null or a.site_id = $1)
        order by case a.severity when 'alta' then 0 when 'media' then 1 else 2 end, a.created_at desc
        limit $2`,
      [opcoes.siteId ?? null, opcoes.limite ?? 100],
    ),
  );
}

export async function historicoDeAlertas(accountId: string, siteId: string, limite = 20): Promise<AlertaAberto[]> {
  return comConta(accountId, (db) =>
    db.query<AlertaAberto>(
      `select a.id, a.site_id as "siteId", s.name as "siteNome", a.kind, a.severity, a.title, a.details, a.state,
              a.created_at as "createdAt", a.resolved_at as "resolvedAt"
         from alerts a left join sites s on s.id = a.site_id
        where a.site_id = $1 order by a.created_at desc limit $2`,
      [siteId, limite],
    ),
  );
}

export async function contarAlertasAbertos(accountId: string): Promise<number> {
  const r = await comConta(accountId, (db) => db.one<{ n: number }>("select count(*)::int as n from alerts where state = 'aberto'"));
  return r?.n ?? 0;
}

export type EstadoDaFila = { monitoresAtivos: number; devidos: number; atrasados: number; maisAntigoSegundos: number | null };

/** Estado da fila visto pela central: quantos monitores estão devidos e há quanto tempo. */
export async function estadoDaFila(accountId: string): Promise<EstadoDaFila> {
  const r = await comConta(accountId, (db) =>
    db.one<EstadoDaFila>(
      `select count(*)::int as "monitoresAtivos",
              count(*) filter (where next_check_at <= now())::int as devidos,
              count(*) filter (where next_check_at < now() - make_interval(secs => interval_seconds * 3))::int as atrasados,
              extract(epoch from now() - min(next_check_at) filter (where next_check_at <= now()))::int as "maisAntigoSegundos"
         from monitors where enabled`,
    ),
  );
  return r ?? { monitoresAtivos: 0, devidos: 0, atrasados: 0, maisAntigoSegundos: null };
}
