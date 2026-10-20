import 'server-only';
import { buscarCliente, buscarSite, listarSites, type Cliente, type SiteComSituacao } from '@/modules/portfolio/consultas';
import { incidentesDoSite, resumoDeChecagens, type Incidente, type ResumoDeChecagens } from '@/modules/monitoring/consultas';
import { ultimasMedicoes, ultimoCrux, urlsDoSite, type Crux, type Medicao } from '@/modules/performance/consultas';
import { botoes, origens, porHora, resumoDeEventos, type Horario, type LinhaDeBotao, type Origem, type Periodo, type ResumoDeEventos } from '@/modules/analytics/consultas';
import { listarSubmissoes, type SubmissaoResumo } from '@/modules/contacts/consultas';
import type { PeriodoDoRelatorio } from '@/modules/reports/periodo';
import { camposSemMensagem, ENVIOS_RECENTES, horasMaisAtivas, incidentesNoPeriodo, LIMITACOES, LIMITE_AMOSTRA_PEQUENA, LIMITE_DE_SUBMISSOES, porEvidencia, type PorEvidencia } from '@/modules/reports/regras';

/**
 * O relatório COMPÕE as consultas que as abas já usam. Nenhum SQL de
 * agregação mora aqui: se um número do relatório discordasse da aba, seria
 * um defeito de composição, não de conta — e o teste R01 compara os dois.
 */

/** Incidentes lidos por site antes do recorte pelo período. */
export const LIMITE_DE_INCIDENTES = 200;

export type EnvioResumido = Omit<SubmissaoResumo, 'fields'> & { campos: Record<string, string> };

export type RelatorioDoSite = {
  cabecalho: {
    siteId: string;
    site: string;
    clienteId: string;
    cliente: string;
    dominio: string;
    url: string;
    fuso: string;
    arquivado: boolean;
    periodo: PeriodoDoRelatorio;
    geradoEm: Date;
  };
  disponibilidade: {
    /** `null` quando o site não tem monitor cadastrado. */
    monitor: null | { habilitado: boolean; intervaloSegundos: number; ultimaChecagem: Date | null; ultimaOk: boolean | null };
    estado: { rotulo: string; frase: string; tom: SiteComSituacao['situacao']['tom'] };
    incidentes: Incidente[];
    /** Janela em horas contada a partir de AGORA (é assim que a consulta funciona), não do início do período. */
    checagens: ResumoDeChecagens | null;
    tls: { estado: 'desconhecido' | 'valido' | 'sem_tls' | 'falha'; expiraEm: Date | null };
  };
  velocidade: {
    configurado: boolean;
    urlsEscolhidas: number;
    medicoes: Medicao[];
    possivelRegressao: boolean;
    crux: Crux[];
  };
  audiencia: { resumo: ResumoDeEventos; origens: Origem[] };
  acoes: { cliques: number; tentativasForm: number; botoes: LinhaDeBotao[] };
  contatos: {
    recebidos: number;
    novosLeads: number;
    porEvidencia: PorEvidencia[];
    tentativas: number;
    recentes: EnvioResumido[];
    /** A lista lida bateu no teto: os agrupamentos abaixo podem estar incompletos. */
    listaCortada: boolean;
  };
  horarios: { horas: Horario[]; maisAtivas: Horario[]; totalAcoes: number; amostraPequena: boolean };
  limitacoes: readonly string[];
};

export type RelatorioDoCliente = {
  cabecalho: { clienteId: string; cliente: string; arquivado: boolean; sitesAtivos: number; periodo: PeriodoDoRelatorio; geradoEm: Date };
  sites: RelatorioDoSite[];
};

function comoPeriodoDeEventos(p: PeriodoDoRelatorio): Periodo {
  return { de: p.de, ate: p.ate, dias: p.dias };
}

/**
 * Relatório de um site. `null` quando o site não é desta conta (RLS: nenhuma
 * linha) — a tela responde 404, nunca 403.
 */
export async function relatorioDoSite(accountId: string, userId: string, siteId: string, periodo: PeriodoDoRelatorio, agora: Date = new Date()): Promise<RelatorioDoSite | null> {
  const site = await buscarSite(accountId, userId, siteId);
  if (!site) return null;
  return montarRelatorioDoSite(accountId, site, periodo, agora);
}

async function montarRelatorioDoSite(accountId: string, site: SiteComSituacao, periodo: PeriodoDoRelatorio, agora: Date): Promise<RelatorioDoSite> {
  const p = comoPeriodoDeEventos(periodo);
  const temMonitor = site.monitor !== null;

  // Em série, como as abas fazem: cada chamada é uma transação com conexão
  // própria, e dez ao mesmo tempo disputariam o pool da central.
  const incidentes: Incidente[] = temMonitor ? await incidentesDoSite(accountId, site.id, LIMITE_DE_INCIDENTES) : [];
  const checagens: ResumoDeChecagens | null = temMonitor ? await resumoDeChecagens(accountId, site.id, periodo.dias * 24) : null;
  const urls = await urlsDoSite(accountId, site.id);
  const medicoes = await ultimasMedicoes(accountId, site.id);
  const crux = await ultimoCrux(accountId, site.id);
  const resumo = await resumoDeEventos(accountId, site.id, p);
  const linhasDeBotoes = await botoes(accountId, site.id, p);
  const origensDasSessoes = await origens(accountId, site.id, p);
  const horas = await porHora(accountId, site.id, site.timezone, p);
  const envios = await listarSubmissoes(accountId, site.id, { de: periodo.de, ate: periodo.ate, limite: LIMITE_DE_SUBMISSOES });

  const evid = porEvidencia(envios);
  const totalAcoes = resumo.cliques + resumo.contatos;

  return {
    cabecalho: {
      siteId: site.id,
      site: site.name,
      clienteId: site.clientId,
      cliente: site.clienteNome,
      dominio: site.domain,
      url: site.primaryUrl,
      fuso: site.timezone,
      arquivado: site.archivedAt !== null,
      periodo,
      geradoEm: agora,
    },
    disponibilidade: {
      monitor: site.monitor
        ? { habilitado: site.monitor.enabled, intervaloSegundos: site.monitor.intervalSeconds, ultimaChecagem: site.monitor.lastCheckAt, ultimaOk: site.monitor.lastOk }
        : null,
      estado: { rotulo: site.situacao.rotulo, frase: site.situacao.frase, tom: site.situacao.tom },
      incidentes: incidentesNoPeriodo(incidentes, periodo),
      checagens,
      tls: { estado: site.monitor?.tlsState ?? 'desconhecido', expiraEm: site.monitor?.tlsExpiresAt ?? null },
    },
    velocidade: {
      configurado: !!process.env.PAGESPEED_API_KEY,
      urlsEscolhidas: urls.length,
      medicoes,
      possivelRegressao: medicoes.some((m) => m.regression),
      crux,
    },
    audiencia: { resumo, origens: origensDasSessoes },
    acoes: { cliques: resumo.cliques, tentativasForm: resumo.tentativasForm, botoes: linhasDeBotoes },
    contatos: {
      recebidos: resumo.contatos,
      novosLeads: resumo.novosLeads,
      porEvidencia: evid.grupos,
      tentativas: evid.tentativas,
      recentes: envios
        .filter((e) => e.receiptStatus !== 'tentativa')
        .slice(0, ENVIOS_RECENTES)
        .map(({ fields, ...resto }) => ({ ...resto, campos: camposSemMensagem(fields) })),
      listaCortada: envios.length >= LIMITE_DE_SUBMISSOES,
    },
    horarios: { horas, maisAtivas: horasMaisAtivas(horas), totalAcoes, amostraPequena: totalAcoes < LIMITE_AMOSTRA_PEQUENA },
    limitacoes: LIMITACOES,
  };
}

/** Cabeçalho do cliente + um relatório por site ATIVO. `null` se o cliente não é desta conta. */
export async function relatorioDoCliente(accountId: string, userId: string, clienteId: string, periodo: PeriodoDoRelatorio, agora: Date = new Date()): Promise<RelatorioDoCliente | null> {
  const cliente: Cliente | null = await buscarCliente(accountId, clienteId);
  if (!cliente) return null;
  const sites = (await listarSites(accountId, userId, { clienteId: cliente.id })).filter((s) => s.archivedAt === null);
  const relatorios: RelatorioDoSite[] = [];
  // Em série, de propósito: cada site abre várias transações; dez sites em
  // paralelo esgotariam o pool da central por um relatório só.
  for (const s of sites) relatorios.push(await montarRelatorioDoSite(accountId, s, periodo, agora));
  return {
    cabecalho: { clienteId: cliente.id, cliente: cliente.name, arquivado: cliente.archivedAt !== null, sitesAtivos: sites.length, periodo, geradoEm: agora },
    sites: relatorios,
  };
}

/** Sites ativos de um cliente, para a tela de seleção decidir o fuso de referência. */
export async function fusosDoCliente(accountId: string, userId: string, clienteId: string): Promise<string[]> {
  const sites = await listarSites(accountId, userId, { clienteId });
  return [...new Set(sites.filter((s) => s.archivedAt === null).map((s) => s.timezone))];
}
