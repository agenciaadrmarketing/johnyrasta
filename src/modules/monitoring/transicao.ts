/**
 * Máquina de estados do monitor. Pura: recebe o que o monitor era, o
 * resultado de UMA checagem e o relógio; devolve o que gravar.
 *
 * Regras (documento de produto, §5.2):
 *  - 1ª falha: abre incidente NÃO confirmado ("suspeita").
 *  - 2ª falha consecutiva, sem lacuna maior que 3 intervalos: confirma e
 *    gera UM alerta de abertura.
 *  - Sucesso com incidente não confirmado: fecha como "isolada", sem alerta.
 *  - Sucesso com incidente confirmado: recupera, gera alerta de recuperação e
 *    resolve o alerta de abertura.
 *  - Em manutenção: tudo é registrado, nenhum alerta operacional é emitido.
 */

export type ResultadoDaChecagem = {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  errorCategory: string | null;
  errorDetail: string | null;
  finalUrl: string | null;
  redirects: number;
  /** Data de expiração do certificado do destino final HTTPS, quando houve handshake. */
  tlsExpiresAt: Date | null;
  /** 'sem_tls' para http://, 'falha' quando o handshake falhou, 'valido' quando houve certificado. */
  tlsState: 'valido' | 'sem_tls' | 'falha' | 'desconhecido';
};

export type EstadoDoMonitor = {
  id: string;
  siteId: string;
  siteNome: string;
  intervalSeconds: number;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  lastCheckAt: Date | null;
  emManutencao: boolean;
  tlsExpiresAt: Date | null;
  incidenteAberto: null | { id: string; confirmado: boolean; firstFailureAt: Date; failedChecks: number };
};

export type Alerta = {
  kind: 'incidente_confirmado' | 'incidente_recuperado' | 'tls_vencendo' | 'tls_falha' | 'verificacao_atrasada';
  severity: 'alta' | 'media' | 'baixa';
  dedupeKey: string;
  title: string;
  details: Record<string, unknown>;
};

export type Transicao = {
  consecutiveFailures: number;
  acao:
    | { tipo: 'nada' }
    | { tipo: 'abrir_incidente' }
    | { tipo: 'confirmar_incidente'; incidenteId: string }
    | { tipo: 'incrementar_incidente'; incidenteId: string }
    | { tipo: 'fechar_isolada'; incidenteId: string }
    | { tipo: 'recuperar'; incidenteId: string };
  alertas: Alerta[];
  /** Chaves de dedupe de alertas a RESOLVER (ex.: o de abertura, ao recuperar). */
  resolver: string[];
};

export const LACUNA_MAXIMA_EM_INTERVALOS = 3;
export const FAIXAS_TLS_DIAS = [30, 14, 7, 1] as const;

export function transicao(m: EstadoDoMonitor, r: ResultadoDaChecagem, agora: Date): Transicao {
  const alertas: Alerta[] = [];
  const resolver: string[] = [];
  const inc = m.incidenteAberto;

  if (!r.ok) {
    // Lacuna maior que 3 intervalos desde a última falha: a contagem recomeça.
    const lacunaMs = m.lastFailureAt ? agora.getTime() - m.lastFailureAt.getTime() : 0;
    const continua = m.consecutiveFailures > 0 && lacunaMs <= m.intervalSeconds * 1000 * LACUNA_MAXIMA_EM_INTERVALOS;
    const falhas = continua ? m.consecutiveFailures + 1 : 1;

    if (!inc || !continua) {
      // Sem incidente aberto (ou a sequência anterior expirou): abre um novo.
      // Se havia um incidente antigo aberto e não confirmado, ele será fechado
      // como isolado pelo chamador antes de abrir (um aberto por monitor).
      return { consecutiveFailures: falhas, acao: { tipo: 'abrir_incidente' }, alertas, resolver };
    }
    if (!inc.confirmado && falhas >= 2) {
      if (!m.emManutencao) {
        alertas.push({
          kind: 'incidente_confirmado',
          severity: 'alta',
          dedupeKey: `incidente:${inc.id}:confirmado`,
          title: `${m.siteNome}: indisponível para o monitor`,
          details: { incidentId: inc.id, siteId: m.siteId, category: r.errorCategory, httpStatus: r.httpStatus, firstFailureAt: inc.firstFailureAt.toISOString(), confirmedAt: agora.toISOString() },
        });
      }
      return { consecutiveFailures: falhas, acao: { tipo: 'confirmar_incidente', incidenteId: inc.id }, alertas, resolver };
    }
    return { consecutiveFailures: falhas, acao: { tipo: 'incrementar_incidente', incidenteId: inc.id }, alertas, resolver };
  }

  // Sucesso.
  if (r.tlsState === 'valido' && r.tlsExpiresAt && !m.emManutencao) {
    const dias = (r.tlsExpiresAt.getTime() - agora.getTime()) / 86_400_000;
    // A faixa mais apertada que ainda contém o prazo: 13 dias é a de 14, não a de 30.
    const faixa = [...FAIXAS_TLS_DIAS].sort((a, b) => a - b).find((f) => dias <= f);
    if (faixa !== undefined) {
      alertas.push({
        kind: 'tls_vencendo',
        severity: faixa <= 7 ? 'alta' : 'media',
        dedupeKey: `tls:${m.id}:${r.tlsExpiresAt.toISOString()}:${faixa}`,
        title: `${m.siteNome}: certificado vence em ${Math.max(0, Math.floor(dias))} ${Math.floor(dias) === 1 ? 'dia' : 'dias'}`,
        details: { siteId: m.siteId, expiresAt: r.tlsExpiresAt.toISOString(), faixaDias: faixa },
      });
    }
  }
  if (!inc) return { consecutiveFailures: 0, acao: { tipo: 'nada' }, alertas, resolver };
  if (!inc.confirmado) return { consecutiveFailures: 0, acao: { tipo: 'fechar_isolada', incidenteId: inc.id }, alertas, resolver };
  resolver.push(`incidente:${inc.id}:confirmado`);
  if (!m.emManutencao) {
    alertas.push({
      kind: 'incidente_recuperado',
      severity: 'baixa',
      dedupeKey: `incidente:${inc.id}:recuperado`,
      title: `${m.siteNome}: respondendo de novo`,
      details: { incidentId: inc.id, siteId: m.siteId, firstFailureAt: inc.firstFailureAt.toISOString(), recoveredAt: agora.toISOString(), observedDurationMs: agora.getTime() - inc.firstFailureAt.getTime() },
    });
  }
  return { consecutiveFailures: 0, acao: { tipo: 'recuperar', incidenteId: inc.id }, alertas, resolver };
}

/**
 * Checagem atrasada: sem nova checagem por mais de 3 intervalos. Usado pelo
 * worker ao retomar (gera o alerta) e pela central (mostra o estado).
 */
export function verificacaoAtrasada(lastCheckAt: Date | null, intervalSeconds: number, agora: Date): boolean {
  if (!lastCheckAt) return false;
  return agora.getTime() - lastCheckAt.getTime() > intervalSeconds * 1000 * LACUNA_MAXIMA_EM_INTERVALOS;
}
