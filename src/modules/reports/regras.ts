/**
 * Regras puras do relatório: recortes e agrupamentos sobre o que as consultas
 * já devolveram. Nada aqui soma por conta própria o que o banco já contou —
 * só filtra, ordena e rotula.
 */

/** Abaixo disto, "melhor horário" não é conclusão (D37). */
export const LIMITE_AMOSTRA_PEQUENA = 30;

/** Quantos envios recentes entram na lista do relatório. */
export const ENVIOS_RECENTES = 10;

/** Teto da lista de submissões lida para agrupar por evidência. Acima disto o relatório avisa que a lista foi cortada. */
export const LIMITE_DE_SUBMISSOES = 1000;

/** O que o relatório NÃO afirma. Impresso em toda versão, sem exceção. */
export const LIMITACOES: readonly string[] = [
  'Checagens bem-sucedidas não equivalem a disponibilidade contínua: são amostras a cada poucos minutos, e lacunas de cobertura ficam indicadas.',
  'Lighthouse é laboratório (simulação); CrUX é campo (usuários reais do Chrome). INP só existe no campo e nunca é deduzido do TBT.',
  'Clique em WhatsApp, telefone ou e-mail é intenção, não contato. Contato é o que foi recebido por formulário.',
  'Sem medição de impressões não há CTR. A tabela de botões mostra cliques, sessões com clique e sessões que clicaram e converteram.',
  'Eventos e envios de diagnóstico (modo de teste) ficam fora de todas as contagens.',
  'Retenção: eventos detalhados 90 dias, checagens 30 dias, medições 12 meses. Períodos mais antigos não têm esses dados.',
];

export type Intervalo = { de: Date; ate: Date };

/** Incidentes que TOCAM o período: começaram antes do fim e não haviam terminado antes do início. */
export function incidentesNoPeriodo<T extends { firstFailureAt: Date; recoveredAt: Date | null }>(incidentes: T[], p: Intervalo): T[] {
  return incidentes.filter((i) => i.firstFailureAt.getTime() <= p.ate.getTime() && (i.recoveredAt === null || i.recoveredAt.getTime() >= p.de.getTime()));
}

/** As horas com mais ações (cliques + contatos), só as que tiveram alguma. Empate: hora mais cedo primeiro. */
export function horasMaisAtivas<T extends { hora: number; cliques: number; contatos: number }>(horas: T[], quantas = 5): T[] {
  return horas
    .filter((h) => h.cliques + h.contatos > 0)
    .sort((a, b) => b.cliques + b.contatos - (a.cliques + a.contatos) || a.hora - b.hora)
    .slice(0, quantas);
}

export type PorEvidencia = { evidencia: string; status: string; total: number };

/**
 * Envios por origem da evidência e estado de recebimento. Tentativas (só o
 * gesto, sem dados) ficam de fora e são contadas à parte: o resumo de
 * eventos também as exclui de "contatos recebidos".
 */
export function porEvidencia<T extends { evidenceSource: string; receiptStatus: string }>(envios: T[]): { grupos: PorEvidencia[]; tentativas: number } {
  const mapa = new Map<string, PorEvidencia>();
  let tentativas = 0;
  for (const e of envios) {
    if (e.receiptStatus === 'tentativa') {
      tentativas += 1;
      continue;
    }
    const chave = `${e.evidenceSource}\u0000${e.receiptStatus}`;
    const g = mapa.get(chave) ?? { evidencia: e.evidenceSource, status: e.receiptStatus, total: 0 };
    g.total += 1;
    mapa.set(chave, g);
  }
  const grupos = [...mapa.values()].sort((a, b) => b.total - a.total || a.evidencia.localeCompare(b.evidencia, 'pt-BR'));
  return { grupos, tentativas };
}

/** Campos de um envio sem a mensagem livre: o relatório é impresso e circula. */
export function camposSemMensagem(fields: Record<string, string>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (k !== 'message' && k !== 'mensagem') saida[k] = v;
  return saida;
}
