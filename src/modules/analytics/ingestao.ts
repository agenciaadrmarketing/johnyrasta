import 'server-only';
import type { Queryable } from '@/shared/db';
import { origemDaSessao, sessaoAindaAtiva, validarEvento, type EventoRecebido } from '@/modules/analytics/regras';

export type SiteParaColeta = { id: string; accountId: string; domain: string; collectPageviews: boolean; collectClicks: boolean };

export async function siteDoPublicId(db: Queryable, publicId: string): Promise<SiteParaColeta | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(publicId)) return null;
  return db.one<SiteParaColeta>(
    `select s.id, s.account_id as "accountId", s.domain,
            coalesce(t.collect_pageviews, true) as "collectPageviews", coalesce(t.collect_clicks, true) as "collectClicks"
       from sites s left join site_tracking t on t.site_id = s.id
      where s.public_id = $1 and s.archived_at is null`,
    [publicId],
  );
}

/** Token de diagnóstico válido para o site? Devolve o id da sessão de diagnóstico. */
export async function diagnosticoValido(db: Queryable, siteId: string, token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const r = await db.one<{ id: string }>('select id from diagnostic_sessions where site_id = $1 and token = $2 and expires_at > now()', [siteId, token]);
  return r?.id ?? null;
}

export type ResultadoDaIngestao = { aceitos: number; duplicados: number; rejeitados: { event_id?: string; motivo: string }[] };

/**
 * Ingestão de um lote. Para cada evento:
 *   1. valida o esquema;
 *   2. DEDUPLICA pela chave (site, event_id) ANTES de tocar na sessão (E01);
 *   3. abre ou estende a sessão pela chave (E02: a chave única impede duas
 *      sessões para a mesma session_key sob concorrência);
 *   4. grava o evento.
 * Eventos de diagnóstico são `is_test` e ficam fora de todo KPI.
 */
export async function ingerirLote(db: Queryable, site: SiteParaColeta, lote: unknown[], agora: Date): Promise<ResultadoDaIngestao> {
  const r: ResultadoDaIngestao = { aceitos: 0, duplicados: 0, rejeitados: [] };
  const tokens = new Map<string, string | null>();
  for (const bruto of lote.slice(0, 50)) {
    const v = validarEvento(bruto, agora);
    if (!v.ok) {
      r.rejeitados.push({ event_id: typeof (bruto as { event_id?: unknown })?.event_id === 'string' ? ((bruto as { event_id: string }).event_id) : undefined, motivo: v.motivo });
      continue;
    }
    const e = v.evento;
    if ((e.type === 'page_view' && !site.collectPageviews) || (e.type === 'click' && !site.collectClicks)) {
      r.rejeitados.push({ event_id: e.event_id, motivo: 'coleta desligada para este tipo' });
      continue;
    }
    // 2. Dedupe antes de efeitos colaterais.
    const existe = await db.one('select 1 from events where site_id = $1 and event_id = $2', [site.id, e.event_id]);
    if (existe) {
      r.duplicados += 1;
      continue;
    }
    let diag: string | null;
    if (tokens.has(e.test_token ?? '')) diag = tokens.get(e.test_token ?? '')!;
    else {
      diag = await diagnosticoValido(db, site.id, e.test_token);
      tokens.set(e.test_token ?? '', diag);
    }
    const isTest = diag !== null;
    const sessionId = await sessaoPara(db, site, e, isTest);
    const inserido = await db.one<{ id: number }>(
      `insert into events (account_id, site_id, event_id, session_id, visitor_id, type, path, button_id, button_pos, button_text, action_kind, auto_detected, occurred_at, is_test)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (site_id, event_id) do nothing returning id`,
      [site.accountId, site.id, e.event_id, sessionId, isTest ? null : e.visitor_id, e.type, e.path, e.button_id, e.button_pos, e.button_text, e.action_kind, e.auto_detected, e.occurred_at, isTest],
    );
    if (!inserido) {
      r.duplicados += 1;
      continue;
    }
    r.aceitos += 1;
    if (diag) {
      await db.query(
        `update diagnostic_sessions set evidence = evidence || jsonb_build_object($2::text, jsonb_build_object('at', $3::timestamptz, 'path', $4::text)) where id = $1`,
        [diag, e.type, e.occurred_at, e.path],
      );
    }
  }
  return r;
}

async function sessaoPara(db: Queryable, site: SiteParaColeta, e: EventoRecebido, isTest: boolean): Promise<string> {
  const ocorrido = new Date(e.occurred_at);
  const atual = await db.one<{ id: string; last_seen_at: Date }>('select id, last_seen_at from sessions where site_id = $1 and session_key = $2 for update', [site.id, e.session_key]);
  if (atual) {
    // E03: evento atrasado (anterior ao last_seen) não encurta; evento após a
    // expiração não reabre — fica na sessão da chave sem estender a janela.
    if (ocorrido > atual.last_seen_at && sessaoAindaAtiva(atual.last_seen_at, ocorrido)) {
      await db.query('update sessions set last_seen_at = $2 where id = $1', [atual.id, ocorrido]);
    }
    return atual.id;
  }
  const origem = origemDaSessao(e.utm ?? {}, e.referrer ?? null, site.domain);
  const nova = await db.one<{ id: string }>(
    `insert into sessions (account_id, site_id, session_key, visitor_id, started_at, last_seen_at, entry_path, source, medium, campaign, referrer_host, device, is_test)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (site_id, session_key) do update set last_seen_at = greatest(sessions.last_seen_at, excluded.last_seen_at)
     returning id`,
    [site.accountId, site.id, e.session_key, isTest ? null : e.visitor_id, ocorrido, e.path, origem.source, origem.medium, origem.campaign, e.referrer ?? null, e.device ?? 'desconhecido', isTest],
  );
  return nova!.id;
}
