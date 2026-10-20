/**
 * Uma rodada: reivindica monitores devidos, verifica cada um (com
 * concorrência limitada), aplica a transição e grava tudo numa transação
 * que confere o lease.
 */
import type { Pool } from 'pg';
import { verificar, type OpcoesDoVerificador } from './verificador';
import { reivindicar, liberar, leaseAindaMeu, type MonitorReivindicado } from './fila';
import { transicao, verificacaoAtrasada, type Alerta, type ResultadoDaChecagem } from '@/modules/monitoring/transicao';

export type OpcoesDaRodada = {
  limite?: number;
  concorrencia?: number;
  workerId: string;
  verificador?: OpcoesDoVerificador;
  /** Injetável para testes. */
  verificar?: (url: string, o?: OpcoesDoVerificador) => Promise<ResultadoDaChecagem>;
  agora?: () => Date;
};

export type ResumoDaRodada = { reivindicados: number; gravados: number; descartados: number; erros: number };

export async function rodada(pool: Pool, o: OpcoesDaRodada): Promise<ResumoDaRodada> {
  const agora = o.agora ?? (() => new Date());
  const limite = o.limite ?? 20;
  const concorrencia = o.concorrencia ?? 5;
  const monitores = await reivindicar(pool, limite, agora());
  const resumo: ResumoDaRodada = { reivindicados: monitores.length, gravados: 0, descartados: 0, erros: 0 };
  const fila = [...monitores];
  const trabalhadores = Array.from({ length: Math.min(concorrencia, fila.length) }, async () => {
    for (;;) {
      const m = fila.shift();
      if (!m) return;
      try {
        const r = await (o.verificar ?? verificar)(m.url, o.verificador);
        const gravou = await gravar(pool, m, r, o.workerId, agora());
        if (gravou) resumo.gravados += 1;
        else resumo.descartados += 1;
      } catch (e) {
        resumo.erros += 1;
        console.error(`[worker] monitor ${m.id} falhou internamente:`, e instanceof Error ? e.message : e);
        await liberar(pool, m.id, m.leaseToken).catch(() => {});
      }
    }
  });
  await Promise.all(trabalhadores);
  return resumo;
}

async function inserirAlerta(c: import('pg').PoolClient, accountId: string, siteId: string | null, a: Alerta): Promise<void> {
  await c.query(
    `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (account_id, dedupe_key) do nothing`,
    [accountId, siteId, a.kind, a.severity, a.dedupeKey, a.title, JSON.stringify(a.details)],
  );
}

/** Grava checagem, aplica a transição e agenda a próxima. `false` = lease perdido, nada gravado. */
export async function gravar(pool: Pool, m: MonitorReivindicado, r: ResultadoDaChecagem, workerId: string, agora: Date): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (!(await leaseAindaMeu(c, m.id, m.leaseToken))) {
      await c.query('rollback');
      return false;
    }
    // Checagem atrasada: o worker esteve parado. Registra o episódio (dedupe por
    // monitor + minuto da última checagem) e resolve ao gravar esta.
    if (verificacaoAtrasada(m.lastCheckAt, m.intervalSeconds, agora) && !m.emManutencao) {
      await inserirAlerta(c, m.accountId, m.siteId, {
        kind: 'verificacao_atrasada',
        severity: 'media',
        dedupeKey: `atraso:${m.id}:${m.lastCheckAt!.toISOString()}`,
        title: `${m.siteNome}: verificação ficou atrasada`,
        details: { siteId: m.siteId, lastCheckAt: m.lastCheckAt!.toISOString(), resumedAt: agora.toISOString() },
      });
      await c.query(
        `update alerts set state = 'resolvido', resolved_at = $3, resolved_by = 'worker'
          where account_id = $1 and dedupe_key = $2 and state = 'aberto'`,
        [m.accountId, `atraso:${m.id}:${m.lastCheckAt!.toISOString()}`, agora],
      );
    }

    await c.query(
      `insert into checks (account_id, monitor_id, site_id, checked_at, ok, http_status, duration_ms, error_category, error_detail, final_url, redirects, tls_expires_at, worker_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [m.accountId, m.id, m.siteId, agora, r.ok, r.httpStatus, r.durationMs, r.errorCategory, r.errorDetail, r.finalUrl, r.redirects, r.tlsExpiresAt, workerId],
    );

    const t = transicao(m, r, agora);
    switch (t.acao.tipo) {
      case 'abrir_incidente': {
        // Um aberto por monitor: se havia um não confirmado de uma sequência
        // que expirou, fecha como isolado antes.
        if (m.incidenteAberto) {
          await c.query(`update incidents set recovered_at = $2, outcome = coalesce(outcome, 'isolada') where id = $1 and recovered_at is null`, [m.incidenteAberto.id, agora]);
        }
        await c.query(
          `insert into incidents (account_id, monitor_id, site_id, first_failure_at, cause_category, cause_detail) values ($1, $2, $3, $4, $5, $6)`,
          [m.accountId, m.id, m.siteId, agora, r.errorCategory, r.errorDetail],
        );
        break;
      }
      case 'confirmar_incidente':
        await c.query(`update incidents set confirmed_at = $2, outcome = 'confirmado', failed_checks = failed_checks + 1, cause_category = $3, cause_detail = $4 where id = $1`, [t.acao.incidenteId, agora, r.errorCategory, r.errorDetail]);
        break;
      case 'incrementar_incidente':
        await c.query(`update incidents set failed_checks = failed_checks + 1 where id = $1`, [t.acao.incidenteId]);
        break;
      case 'fechar_isolada':
        await c.query(`update incidents set recovered_at = $2, outcome = 'isolada' where id = $1`, [t.acao.incidenteId, agora]);
        break;
      case 'recuperar':
        await c.query(`update incidents set recovered_at = $2 where id = $1`, [t.acao.incidenteId, agora]);
        break;
      case 'nada':
        break;
    }
    for (const a of t.alertas) await inserirAlerta(c, m.accountId, m.siteId, a);
    for (const chave of t.resolver) {
      await c.query(`update alerts set state = 'resolvido', resolved_at = $3, resolved_by = 'worker' where account_id = $1 and dedupe_key = $2 and state = 'aberto'`, [m.accountId, chave, agora]);
    }
    if (r.tlsState === 'falha' && !m.emManutencao) {
      await inserirAlerta(c, m.accountId, m.siteId, {
        kind: 'tls_falha',
        severity: 'alta',
        dedupeKey: `tlsfalha:${m.id}:${agora.toISOString().slice(0, 10)}`,
        title: `${m.siteNome}: falha no certificado TLS`,
        details: { siteId: m.siteId, detail: r.errorDetail },
      });
    }

    const proxima = new Date(agora.getTime() + m.intervalSeconds * 1000);
    await c.query(
      `update monitors set
         lease_token = null, lease_until = null,
         consecutive_failures = $2,
         last_check_at = $3, last_ok = $4,
         last_failure_at = case when $4 then last_failure_at else $3 end,
         tls_expires_at = case when $5 = 'valido' then $6 else case when $5 = 'falha' then null else tls_expires_at end end,
         tls_state = $5,
         next_check_at = $7,
         manual_requested_at = null
       where id = $1 and lease_token = $8`,
      [m.id, t.consecutiveFailures, agora, r.ok, r.tlsState, r.tlsExpiresAt, proxima, m.leaseToken],
    );
    await c.query('commit');
    return true;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Retenção: checagens 30 dias, eventos detalhados 90 dias, medições 12 meses. Incidentes, alertas, submissões e contatos ficam. */
export async function retencao(pool: Pool): Promise<{ checks: number; events: number; runs: number }> {
  const c = await pool.query(`delete from checks where checked_at < now() - interval '30 days'`);
  const e = await pool.query(`delete from events where occurred_at < now() - interval '90 days'`);
  // Sessões acompanham os eventos: sem isso, períodos antigos mostrariam "0 sessões" ao lado de origens com sessões.
  await pool.query(`delete from sessions where last_seen_at < now() - interval '90 days' and not exists (select 1 from events x where x.session_id = sessions.id) and not exists (select 1 from submissions b where b.session_id = sessions.id)`);
  const r = await pool.query(`delete from performance_runs where measured_at < now() - interval '12 months'`);
  return { checks: c.rowCount ?? 0, events: e.rowCount ?? 0, runs: r.rowCount ?? 0 };
}

/**
 * Coleta interrompida: site com volume regular (média ≥ 20 eventos/dia nos 7
 * dias anteriores) e zero eventos nas últimas 24 h. Suspeita, não prova; um
 * alerta por site por dia. Sites de baixo tráfego nunca alertam por isto.
 */
export async function alertaDeColetaParada(pool: Pool, agora: Date = new Date()): Promise<number> {
  const r = await pool.query<{ account_id: string; site_id: string; name: string; media: number }>(
    `with v as (
       select e.site_id, count(*) filter (where e.occurred_at >= $1::timestamptz - interval '8 days' and e.occurred_at < $1::timestamptz - interval '1 day')::float / 7 as media,
              count(*) filter (where e.occurred_at >= $1::timestamptz - interval '1 day')::int as ultimas24
         from events e where not e.is_test and e.occurred_at >= $1::timestamptz - interval '8 days' group by e.site_id
     )
     select s.account_id, s.id as site_id, s.name, v.media from v join sites s on s.id = v.site_id
      where v.media >= 20 and v.ultimas24 = 0 and s.archived_at is null`,
    [agora],
  );
  for (const x of r.rows) {
    await pool.query(
      `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details) values ($1, $2, 'coletor_parado', 'media', $3, $4, $5) on conflict (account_id, dedupe_key) do nothing`,
      [x.account_id, x.site_id, `coletor:${x.site_id}:${agora.toISOString().slice(0, 10)}`, `${x.name}: nenhum evento nas últimas 24 h (média de ${Math.round(x.media)}/dia)`, JSON.stringify({ mediaDiaria: x.media })],
    );
  }
  return r.rowCount ?? 0;
}
