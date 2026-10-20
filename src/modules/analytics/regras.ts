/** Regras puras de eventos, sessões, atribuição e horários. */

export const INATIVIDADE_SESSAO_MS = 30 * 60 * 1000;
export const JANELA_ATRIBUICAO_MS = 30 * 60 * 1000;
export const UTMS_PERMITIDAS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

export type TipoDeEvento = 'page_view' | 'click' | 'form_attempt';
export type TipoDeAcao = 'whatsapp' | 'phone' | 'email' | 'form' | 'outro';

export type EventoRecebido = {
  event_id: string;
  type: TipoDeEvento;
  path: string;
  occurred_at: string;
  session_key: string;
  visitor_id?: string | null;
  button_id?: string | null;
  button_pos?: string | null;
  button_text?: string | null;
  action_kind?: TipoDeAcao | null;
  auto_detected?: boolean;
  href?: string | null;
  referrer?: string | null;
  utm?: Record<string, string> | null;
  device?: string | null;
  test_token?: string | null;
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;

export function validarEvento(e: unknown, agora: Date): { ok: true; evento: EventoRecebido } | { ok: false; motivo: string } {
  if (!e || typeof e !== 'object') return { ok: false, motivo: 'evento não é objeto' };
  const x = e as Record<string, unknown>;
  if (typeof x.event_id !== 'string' || !ID.test(x.event_id)) return { ok: false, motivo: 'event_id inválido' };
  if (typeof x.session_key !== 'string' || !ID.test(x.session_key)) return { ok: false, motivo: 'session_key inválida' };
  if (x.type !== 'page_view' && x.type !== 'click' && x.type !== 'form_attempt') return { ok: false, motivo: 'type inválido' };
  if (typeof x.path !== 'string' || !x.path.startsWith('/') || x.path.length > 512) return { ok: false, motivo: 'path inválido' };
  const occ = typeof x.occurred_at === 'string' ? new Date(x.occurred_at) : null;
  if (!occ || Number.isNaN(occ.getTime())) return { ok: false, motivo: 'occurred_at inválido' };
  // Relógio do cliente: até 1 h no passado (fila offline) e 5 min no futuro.
  const delta = agora.getTime() - occ.getTime();
  if (delta > 60 * 60 * 1000 || delta < -5 * 60 * 1000) return { ok: false, motivo: 'occurred_at fora da janela aceitável' };
  const texto = (k: string, max: number) => (typeof x[k] === 'string' ? (x[k] as string).slice(0, max) : null);
  const kind = x.action_kind;
  if (x.type === 'click' && !['whatsapp', 'phone', 'email', 'form', 'outro'].includes(kind as string)) return { ok: false, motivo: 'action_kind obrigatório em click' };
  const utm: Record<string, string> = {};
  if (x.utm && typeof x.utm === 'object') {
    for (const k of UTMS_PERMITIDAS) {
      const v = (x.utm as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) utm[k] = v.trim().slice(0, 100);
    }
  }
  return {
    ok: true,
    evento: {
      event_id: x.event_id,
      type: x.type,
      path: normalizarPath(x.path),
      occurred_at: occ.toISOString(),
      session_key: x.session_key,
      visitor_id: typeof x.visitor_id === 'string' && ID.test(x.visitor_id) ? x.visitor_id : null,
      button_id: texto('button_id', 100),
      button_pos: texto('button_pos', 50),
      button_text: texto('button_text', 80),
      action_kind: x.type === 'click' ? (kind as TipoDeAcao) : null,
      auto_detected: x.auto_detected === true,
      referrer: hostDoReferrer(texto('referrer', 500)),
      utm,
      device: texto('device', 20),
      test_token: texto('test_token', 64),
    },
  };
}

/** Path sem query string nem fragmento: nada de tokens ou dados pessoais na URL. */
export function normalizarPath(p: string): string {
  const semHash = p.split('#')[0]!;
  const semQuery = semHash.split('?')[0]!;
  return semQuery.replace(/\/+$/, '') || '/';
}

export function hostDoReferrer(r: string | null): string | null {
  if (!r) return null;
  try {
    return new URL(r).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Origem da sessão a partir de UTM e referrer. */
export function origemDaSessao(utm: Record<string, string>, referrerHost: string | null, proprioHost: string): { source: string; medium: string | null; campaign: string | null } {
  if (utm.utm_source) return { source: utm.utm_source, medium: utm.utm_medium ?? null, campaign: utm.utm_campaign ?? null };
  if (!referrerHost || referrerHost === proprioHost || referrerHost === `www.${proprioHost}`) return { source: 'direto', medium: null, campaign: null };
  if (/google\./.test(referrerHost)) return { source: 'google', medium: 'organico', campaign: null };
  if (/instagram\.|facebook\.|fb\.|l\.instagram/.test(referrerHost)) return { source: referrerHost.includes('insta') ? 'instagram' : 'facebook', medium: 'social', campaign: null };
  return { source: referrerHost, medium: 'referral', campaign: null };
}

/**
 * E03: um evento pertence à sessão da chave se ocorreu até 30 min depois da
 * última atividade. Evento atrasado após a sessão ter expirado NÃO reabre a
 * sessão antiga nem é empurrado para uma nova: é registrado na sessão da
 * chave, mas não estende `last_seen_at` para antes do que já estava.
 */
export function sessaoAindaAtiva(lastSeenAt: Date, occurredAt: Date): boolean {
  return occurredAt.getTime() - lastSeenAt.getTime() <= INATIVIDADE_SESSAO_MS;
}

/**
 * Atribuição: último clique ELEGÍVEL da mesma sessão, até 30 min antes da
 * submissão. Sem sessão ou sem clique no intervalo: sem atribuição.
 */
export function escolherCliqueAtribuido<T extends { occurredAt: Date; type: string }>(cliques: T[], submissaoEm: Date): T | null {
  const elegiveis = cliques.filter((c) => c.type === 'click' && c.occurredAt <= submissaoEm && submissaoEm.getTime() - c.occurredAt.getTime() <= JANELA_ATRIBUICAO_MS);
  if (!elegiveis.length) return null;
  return elegiveis.reduce((a, b) => (b.occurredAt > a.occurredAt ? b : a));
}

/** Hora (0–23) e dia da semana (0=domingo) de um instante UTC no fuso do site. T01. */
export function horaLocal(utc: Date, fuso: string): { hora: number; diaSemana: number; data: string } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: 'numeric', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(utc);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { hora: Number(get('hour')) % 24, diaSemana: dias.indexOf(get('weekday')), data: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Detecção automática de ação a partir do href. */
export function acaoDoHref(href: string): TipoDeAcao | null {
  const h = href.toLowerCase();
  if (/^https?:\/\/(api\.whatsapp\.com|wa\.me|web\.whatsapp\.com)/.test(h) || h.startsWith('whatsapp:')) return 'whatsapp';
  if (h.startsWith('tel:')) return 'phone';
  if (h.startsWith('mailto:')) return 'email';
  return null;
}

/** Volume regular: média de 7 dias ≥ 20 eventos/dia. Abaixo disso, um dia sem visitas não é suspeita. */
export function coletaParouDeChegar(eventosPorDia7: number[], eventosUltimas24h: number): boolean {
  if (eventosPorDia7.length < 7) return false;
  const media = eventosPorDia7.reduce((a, b) => a + b, 0) / 7;
  return media >= 20 && eventosUltimas24h === 0;
}
