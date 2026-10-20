/**
 * Leitura da resposta do PageSpeed Insights v5. Módulo puro.
 *
 * Separa LABORATÓRIO (Lighthouse: notas, LCP/CLS/TBT simulados, diagnósticos)
 * de CAMPO (CrUX: percentis reais de usuários, URL ou origem, com INP). Não
 * renomeia TBT para INP, não soma economias e não inventa nota quando falta.
 */

export type Dispositivo = 'mobile' | 'desktop';

export type Diagnostico = { id: string; titulo: string; economiaMs: number | null; nota: number | null };

export type Laboratorio = {
  status: 'ok' | 'parcial';
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  diagnosticos: Diagnostico[];
  lighthouseVersion: string | null;
  finalUrl: string | null;
  faltando: string[];
};

export type Campo = {
  scope: 'url' | 'origin';
  identifier: string;
  overall: string | null;
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  raw: unknown;
};

export type Leitura = { laboratorio: Laboratorio; campo: Campo | null; campoInsuficiente: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function nota(cat: unknown): number | null {
  const s = num(obj(cat)?.score);
  return s === null ? null : Math.round(s * 100);
}

function metrica(audits: Json | null, id: string): number | null {
  return num(obj(audits?.[id])?.numericValue);
}

export function lerPageSpeed(resposta: unknown): Leitura {
  const r = obj(resposta);
  const lh = obj(r?.lighthouseResult);
  const cats = obj(lh?.categories);
  const audits = obj(lh?.audits);
  const faltando: string[] = [];
  const pegar = (nome: string, v: number | null) => {
    if (v === null) faltando.push(nome);
    return v;
  };
  const lab: Laboratorio = {
    status: 'ok',
    performance: pegar('performance', nota(cats?.performance)),
    accessibility: pegar('accessibility', nota(cats?.accessibility)),
    bestPractices: pegar('best-practices', nota(cats?.['best-practices'])),
    seo: pegar('seo', nota(cats?.seo)),
    lcpMs: pegar('lcp', metrica(audits, 'largest-contentful-paint')),
    cls: metrica(audits, 'cumulative-layout-shift'),
    tbtMs: pegar('tbt', metrica(audits, 'total-blocking-time')),
    fcpMs: metrica(audits, 'first-contentful-paint'),
    speedIndexMs: metrica(audits, 'speed-index'),
    diagnosticos: [],
    lighthouseVersion: typeof lh?.lighthouseVersion === 'string' ? lh.lighthouseVersion : null,
    finalUrl: typeof lh?.finalUrl === 'string' ? lh.finalUrl : null,
    faltando,
  };
  if (lab.cls === null) faltando.push('cls');
  if (audits) {
    for (const [id, a] of Object.entries(audits)) {
      const au = obj(a);
      const det = obj(au?.details);
      if (det?.type !== 'opportunity') continue;
      const economia = num(det.overallSavingsMs);
      const score = num(au?.score);
      if (score !== null && score >= 0.9) continue;
      lab.diagnosticos.push({ id, titulo: typeof au?.title === 'string' ? au.title : id, economiaMs: economia === null ? null : Math.round(economia), nota: score });
    }
    lab.diagnosticos.sort((a, b) => (b.economiaMs ?? 0) - (a.economiaMs ?? 0));
    lab.diagnosticos = lab.diagnosticos.slice(0, 10);
  }
  if (lab.performance === null) lab.status = 'parcial';
  else if (faltando.length > 0) lab.status = 'parcial';

  // CAMPO: a própria URL quando houver; senão a origem; senão insuficiente.
  const le = obj(r?.loadingExperience);
  const ole = obj(r?.originLoadingExperience);
  const campoDe = (x: Json | null, scope: 'url' | 'origin'): Campo | null => {
    const m = obj(x?.metrics);
    if (!m || Object.keys(m).length === 0) return null;
    const p75 = (k: string) => num(obj(m[k])?.percentile);
    return {
      scope,
      identifier: typeof x?.id === 'string' ? x.id : '',
      overall: typeof x?.overall_category === 'string' ? x.overall_category : null,
      lcpP75Ms: p75('LARGEST_CONTENTFUL_PAINT_MS'),
      inpP75Ms: p75('INTERACTION_TO_NEXT_PAINT'),
      clsP75: (() => { const v = p75('CUMULATIVE_LAYOUT_SHIFT_SCORE'); return v === null ? null : v / 100; })(),
      periodStart: null,
      periodEnd: null,
      raw: x,
    };
  };
  // A fonte diz que caiu para a origem quando `origin_fallback` é verdadeiro.
  const campo = le && le.origin_fallback !== true ? campoDe(le, 'url') : campoDe(ole, 'origin') ?? (le ? campoDe(le, 'origin') : null);
  return { laboratorio: lab, campo, campoInsuficiente: campo === null };
}

/**
 * Possível regressão: queda de ao menos `limiar` pontos de performance em
 * relação à medição comparável anterior (mesma URL e dispositivo, status ok).
 * A variabilidade do Lighthouse é esperada: isto é INDICAÇÃO, confirmada por
 * nova medição antes de alertar.
 */
export function possivelRegressao(atual: number | null, anterior: number | null, limiar = 10): boolean {
  if (atual === null || anterior === null) return false;
  return anterior - atual >= limiar;
}

/**
 * Regressão CONFIRMADA: as duas medições mais recentes (atual e anterior) estão
 * ao menos `limiar` pontos abaixo da medição de referência que veio antes delas.
 * Uma única queda isolada nunca basta (a nota do Lighthouse oscila).
 * `serie` vem da mais nova para a mais antiga: [atual, anterior, referência].
 */
export function regressaoConfirmada(serie: readonly (number | null)[], limiar = 10): boolean {
  const [atual, anterior, base] = serie;
  if (atual == null || anterior == null || base == null) return false;
  return base - atual >= limiar && base - anterior >= limiar;
}

/** A queda se desfez: a medição atual voltou a ficar a menos de `limiar` pontos da referência. */
export function regressaoDesfeita(atual: number | null, base: number | null, limiar = 10): boolean {
  if (atual === null || base === null) return false;
  return base - atual < limiar;
}

export type CategoriaDeErro = 'sem_chave' | 'cota' | 'timeout' | 'pagina_inacessivel' | 'resposta_parcial' | 'resposta_invalida' | 'bloqueado' | 'desconhecido';

/** Classifica a resposta HTTP da API em estados distintos. Nenhum deles vira nota. */
export function classificarErroDaApi(status: number, corpo: unknown): { categoria: CategoriaDeErro; transitorio: boolean; detalhe: string } {
  const msg = (() => {
    const e = obj(obj(corpo)?.error);
    return typeof e?.message === 'string' ? e.message : `HTTP ${status}`;
  })();
  if (status === 429) return { categoria: 'cota', transitorio: true, detalhe: msg };
  if (status === 403 && /quota|limit/i.test(msg)) return { categoria: 'cota', transitorio: true, detalhe: msg };
  if (status === 400 || status === 403) return { categoria: 'bloqueado', transitorio: false, detalhe: msg };
  if (status === 500 && /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|NO_FCP/i.test(msg)) return { categoria: 'pagina_inacessivel', transitorio: false, detalhe: msg };
  if (status === 504 || status === 408) return { categoria: 'timeout', transitorio: true, detalhe: msg };
  if (status >= 500) return { categoria: 'desconhecido', transitorio: true, detalhe: msg };
  return { categoria: 'desconhecido', transitorio: false, detalhe: msg };
}

/** Backoff exponencial com jitter, em ms: 2, 4, 8 min… */
export function atrasoDeRetentativa(tentativa: number, aleatorio = Math.random()): number {
  const base = Math.min(2 ** tentativa * 60_000, 60 * 60_000);
  return Math.round(base * (0.75 + aleatorio * 0.5));
}

export function urlDaApi(url: string, device: Dispositivo, chave: string): string {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', url);
  u.searchParams.set('strategy', device);
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) u.searchParams.append('category', c);
  u.searchParams.set('key', chave);
  return u.toString();
}

export const LIMITE_DE_URLS_POR_SITE = 3;

/** Chave lógica de um trabalho: URL + dispositivo + janela (dia UTC) ou pedido manual. */
export function chaveDoTrabalho(monitoredUrlId: string, device: Dispositivo, janela: string): string {
  return `pagespeed:${monitoredUrlId}:${device}:${janela}`;
}
