/**
 * PageSpeed no worker: AGENDA (enfileira o trabalho diário de cada URL ×
 * dispositivo) e CONSUMIDOR (lease, chamada à API, gravação, retentativas).
 *
 * Sem PAGESPEED_API_KEY nada é agendado: a central mostra "não configurado".
 * 429/cota/timeout → retentativa com backoff, no máximo `max_attempts`; nunca
 * uma nota inventada. Página inacessível e 400 falham de vez.
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { atrasoDeRetentativa, classificarErroDaApi, lerPageSpeed, possivelRegressao, regressaoConfirmada, regressaoDesfeita, urlDaApi, type Dispositivo } from '@/modules/performance/pagespeed';

export const LEASE_PAGESPEED_SEGUNDOS = 180;

export type OpcoesPageSpeed = {
  chave: string | null;
  /** Injetável para testes. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  concorrencia?: number;
  agora?: () => Date;
  workerId: string;
};

/** Janela diária em UTC. */
export function janelaDoDia(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

/** Enfileira um trabalho por URL ativa × dispositivo para a janela de hoje. Idempotente pela chave. */
export async function agendarDiarios(pool: Pool, agora: Date = new Date()): Promise<number> {
  const janela = janelaDoDia(agora);
  const r = await pool.query(
    `insert into audit_jobs (account_id, site_id, kind, dedupe_key, payload, run_after)
     select u.account_id, u.site_id, 'pagespeed',
            'pagespeed:' || u.id || ':' || d || ':' || $1,
            jsonb_build_object('monitoredUrlId', u.id, 'url', u.url, 'device', d),
            $2::timestamptz
       from monitored_urls u
       join sites s on s.id = u.site_id
       cross join lateral unnest(u.devices) as d
      where u.enabled and u.archived_at is null and u.frequency = 'diaria' and s.archived_at is null
        and not exists (
          select 1 from performance_runs p where p.monitored_url_id = u.id and p.device = d and p.measured_at >= $1::date and p.status <> 'erro'
        )
     on conflict do nothing`,
    [janela, agora],
  );
  return r.rowCount ?? 0;
}

type Job = { id: string; accountId: string; siteId: string; monitoredUrlId: string; url: string; device: Dispositivo; attempts: number; maxAttempts: number; token: string };

export async function reivindicarTrabalhos(pool: Pool, limite: number, agora: Date): Promise<Job[]> {
  const token = randomUUID();
  const r = await pool.query<{ id: string; account_id: string; site_id: string; payload: { monitoredUrlId: string; url: string; device: Dispositivo }; attempts: number; max_attempts: number }>(
    `with devidos as (
       select id from audit_jobs
        where kind = 'pagespeed'
          and ((state = 'pendente' and run_after <= $1) or (state = 'processando' and lease_until < $1))
        order by run_after limit $2 for update skip locked
     )
     update audit_jobs j set state = 'processando', lease_token = $3, lease_until = $1::timestamptz + make_interval(secs => $4), attempts = j.attempts + 1
       from devidos d where j.id = d.id
     returning j.id, j.account_id, j.site_id, j.payload, j.attempts, j.max_attempts`,
    [agora, limite, token, LEASE_PAGESPEED_SEGUNDOS],
  );
  return r.rows.map((x) => ({ id: x.id, accountId: x.account_id, siteId: x.site_id, monitoredUrlId: x.payload.monitoredUrlId, url: x.payload.url, device: x.payload.device, attempts: x.attempts, maxAttempts: x.max_attempts, token }));
}

async function medir(job: Job, o: OpcoesPageSpeed): Promise<{ ok: true; corpo: unknown } | { ok: false; status: number; corpo: unknown } | { ok: false; status: 0; corpo: null; erro: string }> {
  const f = o.fetch ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 90_000);
  try {
    const resp = await f(urlDaApi(job.url, job.device, o.chave!), { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const corpo = await resp.json().catch(() => null);
    return resp.ok ? { ok: true, corpo } : { ok: false, status: resp.status, corpo };
  } catch (e) {
    return { ok: false, status: 0, corpo: null, erro: e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function comLease<T>(pool: Pool, job: Job, fn: (c: PoolClient) => Promise<T>): Promise<T | null> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const l = await c.query('select 1 from audit_jobs where id = $1 and lease_token = $2 for update', [job.id, job.token]);
    if (!l.rowCount) { await c.query('rollback'); return null; }
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Depois de gravar uma medição ok: abre o alerta quando a regressão se confirma
 * (duas medições seguidas ≥10 pontos abaixo da referência) e resolve o alerta
 * aberto quando a nota volta. Um alerta por episódio (a chave inclui a referência).
 */
async function avaliarRegressao(c: PoolClient, job: Job, quando: Date): Promise<void> {
  const r = await c.query<{ id: string; performance: number | null }>(
    `select id, performance from performance_runs
      where monitored_url_id = $1 and device = $2 and status = 'ok' and performance is not null
      order by measured_at desc, id desc limit 3`,
    [job.monitoredUrlId, job.device],
  );
  const serie = r.rows.map((x) => x.performance);
  const base = r.rows[2];
  const atual = serie[0] ?? null;
  const prefixo = `regressao:${job.monitoredUrlId}:${job.device}:`;
  if (base && regressaoConfirmada(serie)) {
    await c.query(
      `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details, created_at)
       values ($1, $2, 'regressao_pagespeed', 'media', $3, $4, $5, $6) on conflict (account_id, dedupe_key) do nothing`,
      [job.accountId, job.siteId, `${prefixo}${base.id}`, 'Regressão de velocidade confirmada',
       JSON.stringify({ url: job.url, device: job.device, basePerformance: base.performance, atualPerformance: atual, anteriorPerformance: serie[1] }), quando],
    );
    return;
  }
  // Sem confirmação nesta medição: resolve o que estiver aberto e já se desfez.
  const abertos = await c.query<{ id: string; details: { basePerformance?: number } }>(
    `select id, details from alerts where account_id = $1 and kind = 'regressao_pagespeed' and state = 'aberto' and dedupe_key like $2`,
    [job.accountId, `${prefixo}%`],
  );
  for (const a of abertos.rows) {
    if (regressaoDesfeita(atual, a.details.basePerformance ?? null)) {
      await c.query(`update alerts set state = 'resolvido', resolved_at = $2, resolved_by = 'worker' where id = $1`, [a.id, quando]);
    }
  }
}

export type ResumoPageSpeed = { reivindicados: number; medidos: number; retentativas: number; falhas: number; descartados: number };

export async function rodadaPageSpeed(pool: Pool, o: OpcoesPageSpeed): Promise<ResumoPageSpeed> {
  const agora = o.agora ?? (() => new Date());
  const resumo: ResumoPageSpeed = { reivindicados: 0, medidos: 0, retentativas: 0, falhas: 0, descartados: 0 };
  if (!o.chave) return resumo;
  const jobs = await reivindicarTrabalhos(pool, o.concorrencia ?? 2, agora());
  resumo.reivindicados = jobs.length;
  await Promise.all(
    jobs.map(async (job) => {
      const r = await medir(job, o);
      const quando = agora();
      const gravado = await comLease(pool, job, async (c) => {
        if (r.ok) {
          const leitura = lerPageSpeed(r.corpo);
          const anterior = await c.query<{ performance: number | null }>(
            `select performance from performance_runs where monitored_url_id = $1 and device = $2 and status = 'ok' order by measured_at desc limit 1`,
            [job.monitoredUrlId, job.device],
          );
          const lab = leitura.laboratorio;
          const regressao = possivelRegressao(lab.performance, anterior.rows[0]?.performance ?? null);
          await c.query(
            `insert into performance_runs (account_id, site_id, monitored_url_id, url, device, measured_at, status, error_category, error_detail,
               performance, accessibility, best_practices, seo, lcp_ms, cls, tbt_ms, fcp_ms, speed_index_ms, diagnostics, lighthouse_version, source_version, config, regression, job_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'psi-v5',$21,$22,$23)`,
            [job.accountId, job.siteId, job.monitoredUrlId, job.url, job.device, quando, lab.status, lab.status === 'parcial' ? 'resposta_parcial' : null,
             lab.status === 'parcial' ? `faltando: ${lab.faltando.join(', ')}` : null,
             lab.performance, lab.accessibility, lab.bestPractices, lab.seo, lab.lcpMs === null ? null : Math.round(lab.lcpMs), lab.cls, lab.tbtMs === null ? null : Math.round(lab.tbtMs),
             lab.fcpMs === null ? null : Math.round(lab.fcpMs), lab.speedIndexMs === null ? null : Math.round(lab.speedIndexMs), JSON.stringify(lab.diagnosticos), lab.lighthouseVersion,
             JSON.stringify({ strategy: job.device, categories: ['performance', 'accessibility', 'best-practices', 'seo'], finalUrl: lab.finalUrl }), regressao, job.id],
          );
          if (leitura.campo) {
            const cp = leitura.campo;
            await c.query(
              `insert into crux_snapshots (account_id, site_id, scope, identifier, device, collected_at, overall, lcp_p75_ms, inp_p75_ms, cls_p75, raw)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [job.accountId, job.siteId, cp.scope, cp.identifier, job.device, quando, cp.overall, cp.lcpP75Ms, cp.inpP75Ms, cp.clsP75, JSON.stringify(cp.raw)],
            );
          }
          if (lab.status === 'ok') await avaliarRegressao(c, job, quando);
          await c.query(`update audit_jobs set state = 'concluido', finished_at = $2, lease_token = null, lease_until = null where id = $1`, [job.id, quando]);
          return 'medido' as const;
        }
        const cls = r.status === 0 ? { categoria: (r as { erro: string }).erro === 'timeout' ? 'timeout' : 'desconhecido', transitorio: true, detalhe: (r as { erro: string }).erro } : classificarErroDaApi(r.status, r.corpo);
        const podeTentar = cls.transitorio && job.attempts < job.maxAttempts;
        if (podeTentar) {
          const atraso = atrasoDeRetentativa(job.attempts);
          await c.query(
            `update audit_jobs set state = 'pendente', run_after = $2, last_error = $3, error_category = $4, lease_token = null, lease_until = null where id = $1`,
            [job.id, new Date(quando.getTime() + atraso), cls.detalhe.slice(0, 300), cls.categoria],
          );
          return 'retentativa' as const;
        }
        await c.query(
          `insert into performance_runs (account_id, site_id, monitored_url_id, url, device, measured_at, status, error_category, error_detail, source_version, config, job_id)
           values ($1,$2,$3,$4,$5,$6,'erro',$7,$8,'psi-v5',$9,$10)`,
          [job.accountId, job.siteId, job.monitoredUrlId, job.url, job.device, quando, cls.categoria, cls.detalhe.slice(0, 300), JSON.stringify({ strategy: job.device, attempts: job.attempts }), job.id],
        );
        await c.query(`update audit_jobs set state = 'falhou', finished_at = $2, last_error = $3, error_category = $4, lease_token = null, lease_until = null where id = $1`, [job.id, quando, cls.detalhe.slice(0, 300), cls.categoria]);
        return 'falha' as const;
      });
      if (gravado === null) resumo.descartados += 1;
      else if (gravado === 'medido') resumo.medidos += 1;
      else if (gravado === 'retentativa') resumo.retentativas += 1;
      else resumo.falhas += 1;
    }),
  );
  return resumo;
}

/** Fila parada: trabalhos pendentes devidos há mais de 2 h e nenhum concluído nas últimas 2 h. Um alerta por dia. */
export async function alertaDeFilaParada(pool: Pool, agora: Date = new Date()): Promise<void> {
  const r = await pool.query<{ account_id: string; n: number }>(
    `select account_id, count(*)::int as n from audit_jobs j
      where kind = 'pagespeed' and state = 'pendente' and run_after < $1::timestamptz - interval '2 hours'
        and not exists (select 1 from audit_jobs k where k.account_id = j.account_id and k.kind = 'pagespeed' and k.state = 'concluido' and k.finished_at > $1::timestamptz - interval '2 hours')
      group by account_id`,
    [agora],
  );
  for (const x of r.rows) {
    await pool.query(
      `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details)
       values ($1, null, 'fila_parada', 'media', $2, $3, $4) on conflict (account_id, dedupe_key) do nothing`,
      [x.account_id, `fila:pagespeed:${janelaDoDia(agora)}`, `Fila do PageSpeed parada: ${x.n} ${x.n === 1 ? 'medição devida' : 'medições devidas'} sem processar`, JSON.stringify({ pendentes: x.n })],
    );
  }
}
