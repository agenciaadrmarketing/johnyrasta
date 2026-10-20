/**
 * Adaptador de e-mail do worker, escolhido por EMAIL_PROVIDER:
 *
 *   resend    POST https://api.resend.com/emails        (Authorization: Bearer EMAIL_API_KEY)
 *   postmark  POST https://api.postmarkapp.com/email     (X-Postmark-Server-Token: EMAIL_API_KEY)
 *   webhook   POST EMAIL_WEBHOOK_URL com {to, subject, text, alertId} — integra qualquer coisa
 *   log       só registra no console (desenvolvimento)
 *   ausente   desativado: alertas ficam só na central
 *
 * Contrato: `ok: true` SÓ quando o provedor respondeu 2xx. 429, 5xx e timeout
 * são transitórios (o outbox tenta de novo com backoff); outros 4xx são
 * definitivos. `fetch` é injetável para os testes.
 */
import type { ConfigDeEmail } from '@/modules/notifications/provedor';

export type PedidoDeEmail = { to: string; subject: string; text: string; alertId: string };
export type ResultadoDoEnvio = { ok: true; id?: string } | { ok: false; erro: string; transitorio: boolean };
export type Enviador = (p: PedidoDeEmail) => Promise<ResultadoDoEnvio>;

export type OpcoesDoAdaptador = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (linha: string) => void;
};

export const TIMEOUT_EMAIL_MS = 15_000;

/** Classificação por status HTTP: 429/408/5xx voltam depois; o resto dos 4xx não. */
export function transitorioPorStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

type RespostaHttp = { tipo: 'resposta'; status: number; corpo: string } | { tipo: 'falha'; erro: string; timeout: boolean };

async function postJson(url: string, headers: Record<string, string>, body: unknown, o: OpcoesDoAdaptador): Promise<RespostaHttp> {
  const f = o.fetch ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? TIMEOUT_EMAIL_MS);
  try {
    const resp = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const corpo = await resp.text().catch(() => '');
    return { tipo: 'resposta', status: resp.status, corpo };
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'AbortError';
    return { tipo: 'falha', erro: timeout ? 'timeout' : e instanceof Error ? e.message : String(e), timeout };
  } finally {
    clearTimeout(t);
  }
}

function idDe(corpo: string, campos: string[]): string | undefined {
  try {
    const j = JSON.parse(corpo) as Record<string, unknown>;
    for (const c of campos) {
      const v = j?.[c];
      if (typeof v === 'string' && v) return v;
    }
  } catch {
    // corpo não é JSON: sem id, e tudo bem.
  }
  return undefined;
}

function interpretar(r: RespostaHttp, camposDeId: string[]): ResultadoDoEnvio {
  if (r.tipo === 'falha') return { ok: false, erro: r.timeout ? 'sem resposta do provedor em 15 s' : `rede: ${r.erro}`, transitorio: true };
  if (r.status >= 200 && r.status < 300) return { ok: true, id: idDe(r.corpo, camposDeId) };
  const detalhe = r.corpo.replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ok: false, erro: `HTTP ${r.status}${detalhe ? `: ${detalhe}` : ''}`, transitorio: transitorioPorStatus(r.status) };
}

/** Cria o enviador para a configuração lida do ambiente. `null` = desativado. */
export function criarEnviador(cfg: ConfigDeEmail, o: OpcoesDoAdaptador = {}): Enviador | null {
  if (!cfg.ativo) return null;
  switch (cfg.provedor) {
    case 'resend':
      return async (p) =>
        interpretar(
          await postJson('https://api.resend.com/emails', { authorization: `Bearer ${cfg.apiKey}` }, { from: cfg.from, to: [p.to], subject: p.subject, text: p.text }, o),
          ['id'],
        );
    case 'postmark':
      return async (p) =>
        interpretar(
          await postJson('https://api.postmarkapp.com/email', { 'x-postmark-server-token': cfg.apiKey ?? '' }, { From: cfg.from, To: p.to, Subject: p.subject, TextBody: p.text, MessageStream: 'outbound' }, o),
          ['MessageID'],
        );
    case 'webhook':
      return async (p) =>
        interpretar(await postJson(cfg.webhookUrl ?? '', cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}, { to: p.to, subject: p.subject, text: p.text, alertId: p.alertId, from: cfg.from }, o), ['id', 'messageId']);
    case 'log': {
      const log = o.log ?? ((l: string) => console.log(l));
      return async (p) => {
        log(`[email:log] para=${p.to} alerta=${p.alertId}\n  assunto: ${p.subject}\n${p.text.split('\n').map((l) => `  | ${l}`).join('\n')}`);
        return { ok: true, id: `log-${p.alertId}` };
      };
    }
  }
}
