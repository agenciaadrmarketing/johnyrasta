/**
 * Período de um relatório, resolvido a partir da query da URL.
 *
 * Módulo puro: recebe texto (`?dias=30` ou `?de=2026-10-01&ate=2026-10-07`),
 * o fuso IANA do site e o relógio, e devolve instantes UTC ou um erro em
 * português. Nada aqui consulta banco; a tela, o CSV e o teste usam a mesma
 * função, por isso nunca discordam sobre o que é "o período".
 *
 * Duas formas, de propósito diferentes:
 *
 *  - `dias` (7, 30 ou 90): janela MÓVEL que termina agora — exatamente a de
 *    `periodoDeDias()` em analytics, a mesma que a aba Botões e horários e o
 *    CSV de eventos usam. É o que permite linkar o CSV com `?dias=` e garantir
 *    que os números do relatório e do arquivo batam.
 *
 *  - `de`/`ate` (AAAA-MM-DD): dias de CALENDÁRIO no fuso do site. "de" começa
 *    às 00:00 e "ate" termina às 23:59:59.999 desse fuso, convertidos para
 *    UTC. Meia-noite em São Paulo não é meia-noite UTC: um evento às 02:59Z do
 *    dia seguinte ainda pertence ao dia anterior em São Paulo (T01).
 */

export const DIAS_PADRAO = [7, 30, 90] as const;
export type DiasPadrao = (typeof DIAS_PADRAO)[number];
export const MAXIMO_DE_DIAS = 366;

export type EntradaDePeriodo = { dias?: string | null; de?: string | null; ate?: string | null };

export type PeriodoDoRelatorio = {
  /** Início, em UTC (inclusivo). */
  de: Date;
  /** Fim, em UTC (inclusivo). */
  ate: Date;
  /** Dias cobertos: os `dias` pedidos, ou o número de dias de calendário entre `de` e `ate`. */
  dias: number;
  /** Texto para o cabeçalho, já em português e no fuso do site. */
  rotulo: string;
  /** `padrao` = janela móvel (7/30/90); `personalizado` = datas de calendário. */
  modo: 'padrao' | 'personalizado';
  /** Preenchido só no modo padrão: é o valor que as rotas de CSV aceitam. */
  diasPadrao: DiasPadrao | null;
  /** Fuso em que as datas foram interpretadas. */
  fuso: string;
};

export type ResultadoDoPeriodo = { ok: true; periodo: PeriodoDoRelatorio } | { ok: false; erro: string };

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Partes de calendário de um instante, vistas de dentro do fuso. */
function partesNoFuso(fuso: string, instante: Date): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const n = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value ?? '0');
  // Alguns motores devolvem "24" para meia-noite mesmo com h23; normaliza.
  return { ano: n('year'), mes: n('month'), dia: n('day'), hora: n('hour') % 24, minuto: n('minute'), segundo: n('second') };
}

/** Diferença, em ms, entre a parede do fuso e UTC num instante. São Paulo = -3 h. */
function deslocamentoMs(fuso: string, instante: Date): number {
  const p = partesNoFuso(fuso, instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Instante UTC de uma hora de parede no fuso. Dois passos resolvem a troca de
 * horário de verão: o primeiro chute usa o deslocamento de "agora naquela
 * data em UTC"; o segundo corrige com o deslocamento do instante encontrado.
 */
export function instanteNoFuso(fuso: string, ano: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0, ms = 0): Date {
  const parede = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, ms);
  const primeiro = parede - deslocamentoMs(fuso, new Date(parede));
  const segundoPasso = parede - deslocamentoMs(fuso, new Date(primeiro));
  return new Date(segundoPasso);
}

export function fusoExiste(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Lê AAAA-MM-DD e confere que é um dia real (31/02 e 2026-13-01 são recusados). */
export function lerDataIso(texto: string): { ano: number; mes: number; dia: number } | null {
  const m = DATA_ISO.exec(texto.trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const prova = new Date(Date.UTC(ano, mes - 1, dia));
  if (prova.getUTCFullYear() !== ano || prova.getUTCMonth() !== mes - 1 || prova.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

const fmtData = (fuso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDataHora = (fuso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Resolve o período. Regras:
 *  - `de` ou `ate` presentes (ou `dias=personalizado`) → modo personalizado; os dois são obrigatórios.
 *  - senão `dias` ∈ {7, 30, 90}; ausente → 30. Outro valor é erro, não silêncio.
 *  - `de` > `ate` é erro; mais de 366 dias é erro; início no futuro é erro.
 *  - `ate` depois de agora é cortado em agora: não se relata o que ainda não aconteceu.
 */
export function periodoDoRelatorio(entrada: EntradaDePeriodo, fuso: string, agora: Date): ResultadoDoPeriodo {
  if (!fusoExiste(fuso)) return { ok: false, erro: `Fuso horário desconhecido: ${fuso}.` };
  const de = (entrada.de ?? '').trim();
  const ate = (entrada.ate ?? '').trim();
  const diasTexto = (entrada.dias ?? '').trim();
  const personalizado = de !== '' || ate !== '' || diasTexto === 'personalizado';

  if (!personalizado) {
    const dias = diasTexto === '' ? 30 : Number(diasTexto);
    if (!(DIAS_PADRAO as readonly number[]).includes(dias)) {
      return { ok: false, erro: 'Período inválido. Use 7, 30 ou 90 dias, ou informe datas de início e fim.' };
    }
    const inicio = new Date(agora.getTime() - dias * 86_400_000);
    return {
      ok: true,
      periodo: {
        de: inicio,
        ate: agora,
        dias,
        rotulo: `últimos ${dias} dias · ${fmtDataHora(fuso).format(inicio)} a ${fmtDataHora(fuso).format(agora)}`,
        modo: 'padrao',
        diasPadrao: dias as DiasPadrao,
        fuso,
      },
    };
  }

  if (de === '' || ate === '') return { ok: false, erro: 'Para um período personalizado, informe a data de início e a de fim.' };
  const dDe = lerDataIso(de);
  const dAte = lerDataIso(ate);
  if (!dDe) return { ok: false, erro: 'Data de início inválida. Use o formato AAAA-MM-DD.' };
  if (!dAte) return { ok: false, erro: 'Data de fim inválida. Use o formato AAAA-MM-DD.' };

  const inicio = instanteNoFuso(fuso, dDe.ano, dDe.mes, dDe.dia, 0, 0, 0, 0);
  const fimDoDia = instanteNoFuso(fuso, dAte.ano, dAte.mes, dAte.dia, 23, 59, 59, 999);
  if (inicio.getTime() > fimDoDia.getTime()) return { ok: false, erro: 'A data de início é posterior à de fim.' };
  if (inicio.getTime() > agora.getTime()) return { ok: false, erro: 'O período começa no futuro; não há nada a relatar.' };

  // Dias de calendário, inclusivos (01 a 07 = 7 dias). Calculado sobre as
  // datas UTC "puras", imune a horário de verão.
  const dias = Math.round((Date.UTC(dAte.ano, dAte.mes - 1, dAte.dia) - Date.UTC(dDe.ano, dDe.mes - 1, dDe.dia)) / 86_400_000) + 1;
  if (dias > MAXIMO_DE_DIAS) return { ok: false, erro: `Período de ${dias} dias. O máximo é ${MAXIMO_DE_DIAS}.` };

  const cortado = fimDoDia.getTime() > agora.getTime();
  const fim = cortado ? agora : fimDoDia;
  const rotulo = `${fmtData(fuso).format(inicio)} a ${fmtData(fuso).format(fimDoDia)}${cortado ? ` (até ${fmtDataHora(fuso).format(agora)})` : ''} · dias no fuso ${fuso}`;
  return { ok: true, periodo: { de: inicio, ate: fim, dias, rotulo, modo: 'personalizado', diasPadrao: null, fuso } };
}

/** Querystring que reproduz o período (para links entre relatórios). */
export function queryDoPeriodo(entrada: EntradaDePeriodo): string {
  const p = new URLSearchParams();
  const de = (entrada.de ?? '').trim();
  const ate = (entrada.ate ?? '').trim();
  if (de || ate) {
    if (de) p.set('de', de);
    if (ate) p.set('ate', ate);
  } else if ((entrada.dias ?? '').trim()) {
    p.set('dias', (entrada.dias ?? '').trim());
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
