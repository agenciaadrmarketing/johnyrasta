/**
 * Outbox de e-mail: ENFILEIRAR (alertas abertos → uma entrega por
 * destinatário) e ENTREGAR (reivindicar pendentes, chamar o provedor, marcar
 * enviado/reagendar/falhou).
 *
 * O que impede reenvio:
 *   · `alerts.dedupe_key` — a mesma condição é UM alerta (Fase 2);
 *   · UNIQUE (alert_id, channel, recipient) — um alerta chega UMA vez a cada
 *     caixa de entrada, mesmo com dez rodadas ou dois workers.
 * Abertura e recuperação são alertas distintos: cada um tem a sua entrega.
 *
 * Sem provedor configurado (`enviar` nulo) a rodada não faz nada: nenhuma
 * entrega é criada, para que ligar o provedor depois não despeje histórico.
 */
import type { Pool } from 'pg';
import { devePublicar, montarMensagem } from '@/modules/notifications/mensagem';
import { atrasoDeReentrega } from '@/modules/notifications/regras';
import type { Enviador } from './email';

export type OpcoesOutbox = {
  enviar: Enviador | null;
  /** Nome do provedor, gravado em cada entrega. */
  provedor?: string;
  urlDaCentral?: string | null;
  agora?: () => Date;
  limite?: number;
  concorrencia?: number;
  /** Injetável para testes de backoff. */
  aleatorio?: () => number;
};

export type ResumoOutbox = { enfileiradas: number; reivindicadas: number; enviadas: number; reagendadas: number; falhas: number; descartadas: number };

/** Enquanto um worker tenta, outro não pega a mesma entrega: reserva de 10 min via `next_attempt_at`. */
const RESERVA_MS = 10 * 60_000;

/**
 * Enfileira entregas para alertas ABERTOS criados depois da última alteração
 * das preferências da conta, que ainda não têm entrega para algum
 * destinatário. A decisão final é de `devePublicar` (pura, testada em unidade).
 */
export async function enfileirar(pool: Pool, agora: Date): Promise<number> {
  const r = await pool.query<{
    id: string; account_id: string; site_id: string | null; kind: string; site_visivel: string | null;
    email_enabled: boolean; email_recipients: string[]; kinds: string[]; site_email_enabled: boolean | null;
  }>(
    `select a.id, a.account_id, a.site_id, a.kind, s.id as site_visivel,
            ns.email_enabled, ns.email_recipients, ns.kinds, sp.email_enabled as site_email_enabled
       from alerts a
       join notification_settings ns on ns.account_id = a.account_id
       left join sites s on s.id = a.site_id
       left join site_notification_prefs sp on sp.site_id = a.site_id
      where a.state = 'aberto'
        and ns.email_enabled
        and a.created_at >= ns.updated_at
        and a.created_at <= $1
        and exists (
          select 1 from unnest(ns.email_recipients) r
           where not exists (select 1 from alert_deliveries d where d.alert_id = a.id and d.channel = 'email' and d.recipient = r)
        )
      order by a.created_at
      limit 200`,
    [agora],
  );
  let n = 0;
  for (const a of r.rows) {
    // Site arquivado (invisível para o worker) ou apagado: nada a avisar.
    if (a.site_id && !a.site_visivel) continue;
    const publicar = devePublicar(
      { emailEnabled: a.email_enabled, recipients: a.email_recipients, kinds: a.kinds },
      a.site_email_enabled === null ? null : { emailEnabled: a.site_email_enabled },
      { kind: a.kind, siteId: a.site_id },
    );
    if (!publicar) continue;
    const ins = await pool.query(
      `insert into alert_deliveries (account_id, alert_id, channel, recipient, next_attempt_at, created_at, updated_at)
       select $1, $2, 'email', r, $3, $3, $3 from unnest($4::text[]) r
       on conflict (alert_id, channel, recipient) do nothing`,
      [a.account_id, a.id, agora, a.email_recipients],
    );
    n += ins.rowCount ?? 0;
  }
  return n;
}

type EntregaReivindicada = {
  id: string; account_id: string; alert_id: string; recipient: string; attempts: number; max_attempts: number;
  kind: string; title: string; details: Record<string, unknown>; created_at: Date; site_id: string | null;
  site_nome: string | null; site_domain: string | null; site_fuso: string | null;
  email_enabled: boolean | null; email_recipients: string[] | null;
};

/** Reivindica pendentes devidas (SKIP LOCKED), já com o alerta e o site para montar a mensagem. */
export async function reivindicarEntregas(pool: Pool, limite: number, agora: Date): Promise<EntregaReivindicada[]> {
  const r = await pool.query<EntregaReivindicada>(
    `with devidas as (
       select id from alert_deliveries
        where state = 'pendente' and next_attempt_at <= $1
        order by next_attempt_at
        limit $2
        for update skip locked
     ), marcadas as (
       update alert_deliveries d
          set attempts = d.attempts + 1, next_attempt_at = $1::timestamptz + make_interval(secs => $3), updated_at = $1
         from devidas where d.id = devidas.id
       returning d.id, d.account_id, d.alert_id, d.recipient, d.attempts, d.max_attempts
     )
     select m.id, m.account_id, m.alert_id, m.recipient, m.attempts, m.max_attempts,
            a.kind, a.title, a.details, a.created_at, a.site_id,
            s.name as site_nome, s.domain as site_domain, s.timezone as site_fuso,
            ns.email_enabled, ns.email_recipients
       from marcadas m
       join alerts a on a.id = m.alert_id
       left join sites s on s.id = a.site_id
       left join notification_settings ns on ns.account_id = m.account_id`,
    [agora, limite, RESERVA_MS / 1000],
  );
  return r.rows;
}

async function entregarUma(pool: Pool, e: EntregaReivindicada, o: OpcoesOutbox, enviar: Enviador, agora: Date): Promise<'enviada' | 'reagendada' | 'falha' | 'descartada'> {
  const provedor = o.provedor ?? 'desconhecido';
  // Preferência mudou entre enfileirar e enviar: não manda.
  if (!e.email_enabled || !(e.email_recipients ?? []).includes(e.recipient)) {
    await pool.query(`update alert_deliveries set state = 'descartado', last_error = $2, provider = $3, updated_at = $4 where id = $1`, [e.id, 'preferência alterada antes do envio', provedor, agora]);
    return 'descartada';
  }
  const msg = montarMensagem({
    kind: e.kind,
    title: e.title,
    details: e.details ?? {},
    siteId: e.site_id,
    siteNome: e.site_nome,
    siteDomain: e.site_domain,
    createdAt: e.created_at,
    fuso: e.site_fuso ?? 'America/Sao_Paulo',
    urlDaCentral: o.urlDaCentral ?? null,
  });
  let r: Awaited<ReturnType<Enviador>>;
  try {
    r = await enviar({ to: e.recipient, subject: msg.assunto, text: msg.corpo, alertId: e.alert_id });
  } catch (err) {
    r = { ok: false, erro: `adaptador lançou: ${err instanceof Error ? err.message : String(err)}`, transitorio: true };
  }
  if (r.ok) {
    await pool.query(
      `update alert_deliveries set state = 'enviado', sent_at = $2, provider = $3, provider_message_id = $4, last_error = null, updated_at = $2 where id = $1`,
      [e.id, agora, provedor, r.id ?? null],
    );
    return 'enviada';
  }
  const erro = r.erro.slice(0, 300);
  if (r.transitorio && e.attempts < e.max_attempts) {
    const atraso = atrasoDeReentrega(e.attempts, (o.aleatorio ?? Math.random)());
    await pool.query(`update alert_deliveries set next_attempt_at = $2, last_error = $3, provider = $4, updated_at = $5 where id = $1`, [e.id, new Date(agora.getTime() + atraso), erro, provedor, agora]);
    return 'reagendada';
  }
  await pool.query(`update alert_deliveries set state = 'falhou', last_error = $2, provider = $3, updated_at = $4 where id = $1`, [e.id, erro, provedor, agora]);
  return 'falha';
}

/** Uma rodada completa. Sem `enviar`, não faz nada. */
export async function rodadaOutbox(pool: Pool, o: OpcoesOutbox): Promise<ResumoOutbox> {
  const resumo: ResumoOutbox = { enfileiradas: 0, reivindicadas: 0, enviadas: 0, reagendadas: 0, falhas: 0, descartadas: 0 };
  const enviar = o.enviar;
  if (!enviar) return resumo;
  const agora = o.agora ?? (() => new Date());
  resumo.enfileiradas = await enfileirar(pool, agora());
  const fila = await reivindicarEntregas(pool, o.limite ?? 20, agora());
  resumo.reivindicadas = fila.length;
  const trabalhadores = Array.from({ length: Math.min(o.concorrencia ?? 5, fila.length) }, async () => {
    for (;;) {
      const e = fila.shift();
      if (!e) return;
      try {
        const r = await entregarUma(pool, e, o, enviar, agora());
        if (r === 'enviada') resumo.enviadas += 1;
        else if (r === 'reagendada') resumo.reagendadas += 1;
        else if (r === 'descartada') resumo.descartadas += 1;
        else resumo.falhas += 1;
      } catch (err) {
        // Falha interna (banco): a reserva de 10 min expira e a entrega volta à fila.
        resumo.falhas += 1;
        console.error(`[worker] entrega ${e.id} falhou internamente:`, err instanceof Error ? err.message : err);
      }
    }
  });
  await Promise.all(trabalhadores);
  return resumo;
}

/** Para o heartbeat: pendentes agora e falhas definitivas nas últimas 24 h. */
export async function estadoDoOutbox(pool: Pool): Promise<{ pendentes: number; falhas24h: number }> {
  const r = await pool.query<{ pendentes: number; falhas24h: number }>(
    `select count(*) filter (where state = 'pendente')::int as pendentes,
            count(*) filter (where state = 'falhou' and updated_at > now() - interval '24 hours')::int as "falhas24h"
       from alert_deliveries`,
  );
  return r.rows[0] ?? { pendentes: 0, falhas24h: 0 };
}
