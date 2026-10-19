/**
 * A SITUAÇÃO de um site, derivada de fatos e nunca inventada.
 *
 * Módulo puro: recebe os fatos (monitor cadastrado? última checagem? worker
 * visto?) e devolve estado, frase e próxima ação. É a mesma função para a
 * linha de projeto, o resumo do site e a lista de Atenção — por isso os três
 * nunca discordam.
 *
 * Na Fase 1 não existe checagem: todo site monitorado é "Nunca verificado",
 * e a próxima ação diz que o worker ainda não está em execução. Isso é
 * deliberado: mostrar verde sem medição seria o defeito que a V2 existe para
 * não ter.
 */
import type { TomDeEstado } from '@/shared/ui/SeloEstado';

export type EstadoDoSite =
  | 'nunca_verificado'
  | 'online'
  | 'suspeita'
  | 'indisponivel'
  | 'recuperado'
  | 'verificacao_atrasada'
  | 'em_manutencao'
  | 'pausado'
  | 'sem_monitor'
  | 'arquivado';

export const ESTADO_LABEL: Record<EstadoDoSite, string> = {
  nunca_verificado: 'Nunca verificado',
  online: 'Online',
  suspeita: 'Suspeita de falha',
  indisponivel: 'Indisponível para o monitor',
  recuperado: 'Recuperado',
  verificacao_atrasada: 'Verificação atrasada',
  em_manutencao: 'Em manutenção',
  pausado: 'Monitor pausado',
  sem_monitor: 'Sem monitoramento',
  arquivado: 'Arquivado',
};

export const ESTADO_TOM: Record<EstadoDoSite, TomDeEstado> = {
  nunca_verificado: 'soft',
  online: 'ok',
  suspeita: 'warn',
  indisponivel: 'neg',
  recuperado: 'ok',
  verificacao_atrasada: 'warn',
  em_manutencao: 'soft',
  pausado: 'soft',
  sem_monitor: 'soft',
  arquivado: 'soft',
};

export type FatosDoSite = {
  arquivado: boolean;
  monitor: null | {
    habilitado: boolean;
    intervaloSegundos: number;
    manutencaoAte: Date | null;
    /** Última checagem (Fase 2). `null` na Fase 1. */
    ultimaChecagem: null | { em: Date; ok: boolean };
    /** Incidente aberto (Fase 2). */
    incidenteAberto: null | { desde: Date; confirmado: boolean };
    /** Duas falhas consecutivas já confirmaram? */
    recuperadoEm: Date | null;
  };
};

export type Situacao = {
  estado: EstadoDoSite;
  rotulo: string;
  tom: TomDeEstado;
  /** Uma frase, em linguagem simples. */
  frase: string;
  /** O que fazer a seguir, quando há o que fazer. */
  proximaAcao: null | { texto: string; href: string };
  /** Ordem na central: menor aparece antes. */
  prioridade: number;
  verificadoEm: Date | null;
};

const ATRASO_EM_INTERVALOS = 3;

export function situacaoDoSite(siteId: string, fatos: FatosDoSite, agora: Date = new Date()): Situacao {
  const base = (estado: EstadoDoSite, frase: string, prioridade: number, proximaAcao: Situacao['proximaAcao'] = null, verificadoEm: Date | null = null): Situacao => ({
    estado,
    rotulo: ESTADO_LABEL[estado],
    tom: ESTADO_TOM[estado],
    frase,
    proximaAcao,
    prioridade,
    verificadoEm,
  });

  if (fatos.arquivado) return base('arquivado', 'Projeto arquivado. Nada é verificado.', 90);

  const m = fatos.monitor;
  if (!m) {
    return base('sem_monitor', 'Disponibilidade não é verificada neste site.', 50, {
      texto: 'Ativar monitoramento',
      href: `/sites/${siteId}/editar`,
    });
  }
  if (!m.habilitado) return base('pausado', 'Monitor pausado por você. Disponibilidade não é calculada.', 60);
  if (m.manutencaoAte && m.manutencaoAte > agora) {
    return base('em_manutencao', `Janela de manutenção até ${m.manutencaoAte.toLocaleString('pt-BR')}. Alertas suprimidos.`, 55);
  }
  if (!m.ultimaChecagem) {
    return base('nunca_verificado', 'Ainda não há checagem registrada: sem evidência de disponibilidade.', 20, {
      texto: 'Ver estado do worker',
      href: '/configuracoes#sistema',
    });
  }

  const ultima = m.ultimaChecagem;
  const atrasoMs = agora.getTime() - ultima.em.getTime();
  if (atrasoMs > m.intervaloSegundos * 1000 * ATRASO_EM_INTERVALOS) {
    return base('verificacao_atrasada', 'Sem nova checagem há mais de três intervalos. O último resultado não vale mais.', 10, {
      texto: 'Ver estado do worker',
      href: '/configuracoes#sistema',
    }, ultima.em);
  }
  if (m.incidenteAberto) {
    if (m.incidenteAberto.confirmado) {
      return base('indisponivel', 'Falha confirmada pelo monitor em duas checagens seguidas.', 0, {
        texto: 'Abrir disponibilidade',
        href: `/sites/${siteId}/disponibilidade`,
      }, ultima.em);
    }
    return base('suspeita', 'Primeira falha recente. Aguardando confirmação na próxima checagem.', 5, null, ultima.em);
  }
  if (m.recuperadoEm && agora.getTime() - m.recuperadoEm.getTime() < 60 * 60 * 1000) {
    return base('recuperado', 'Respondendo de novo após um incidente.', 15, null, ultima.em);
  }
  return base('online', 'Funcionando: a última checagem respondeu.', 40, null, ultima.em);
}
