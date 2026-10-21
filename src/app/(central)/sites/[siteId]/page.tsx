import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite, estadoDoWorker, workerSemSinal } from '@/modules/portfolio/consultas';
import { historicoDeAlertas, incidentesDoSite, ROTULO_ALERTA, ROTULO_CATEGORIA } from '@/modules/monitoring/consultas';
import { listarSubmissoes } from '@/modules/contacts/consultas';
import { LinhaDoTempo, type Acontecimento } from '@/shared/ui/LinhaDoTempo';
import { ultimasMedicoes, urlsDoSite } from '@/modules/performance/consultas';
import { periodoDeDias, resumoDeEventos, rastreamentoDoSite } from '@/modules/analytics/consultas';
import { arquivarSite } from '@/modules/portfolio/acoes';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { PLATAFORMAS } from '@/shared/validation/site';
import { dataHora, haQuantoTempo, quandoRelativoOuData } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Resumo do site' };

/**
 * Resumo: situação atual, o que precisa de atenção e os fatos do cadastro.
 * Cada recurso aparece com o estado REAL: "aguardando worker", "não
 * configurado", "aguardando primeira medição". Nunca "tudo configurado".
 */
export default async function PaginaResumo({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const worker = await estadoDoWorker(u.accountId);
  const alertas = await historicoDeAlertas(u.accountId, site.id, 8);
  const incidentes = await incidentesDoSite(u.accountId, site.id, 5);
  const urls = await urlsDoSite(u.accountId, site.id);
  const medicoes = await ultimasMedicoes(u.accountId, site.id);
  const temChave = !!process.env.PAGESPEED_API_KEY;
  const eventos = await resumoDeEventos(u.accountId, site.id, periodoDeDias(30));
  const rastreio = await rastreamentoDoSite(u.accountId, site.id);
  const envios = await listarSubmissoes(u.accountId, site.id, { limite: 5 });
  const quandoTexto = (d: Date) => quandoRelativoOuData(d, site.timezone);
  // Só fatos registrados, dos quatro módulos; o mais recente primeiro; sem nada fictício.
  const acontecimentos: Acontecimento[] = [
    ...incidentes.flatMap((i): Acontecimento[] => [
      ...(i.recoveredAt ? [{ id: `inc-rec-${i.id}`, quando: new Date(i.recoveredAt), icone: 'verificar' as const, tom: 'ok' as const, titulo: 'Site respondendo de novo', detalhe: `Incidente de ${ROTULO_CATEGORIA[i.causeCategory ?? ''] ?? i.causeCategory ?? 'causa não classificada'} encerrado`, href: `/sites/${site.id}/disponibilidade`, quandoTexto: quandoTexto(new Date(i.recoveredAt)) }] : []),
      { id: `inc-${i.id}`, quando: new Date(i.confirmedAt ?? i.firstFailureAt), icone: 'alerta' as const, tom: i.confirmedAt ? ('neg' as const) : ('warn' as const), titulo: i.confirmedAt ? 'Indisponível para o monitor' : 'Falha isolada', detalhe: `${ROTULO_CATEGORIA[i.causeCategory ?? ''] ?? i.causeCategory ?? 'causa não classificada'}${i.causeDetail ? ` · ${i.causeDetail}` : ''}`, href: `/sites/${site.id}/disponibilidade`, quandoTexto: quandoTexto(new Date(i.confirmedAt ?? i.firstFailureAt)) },
    ]),
    ...alertas.filter((a) => !['incidente_confirmado', 'incidente_recuperado'].includes(a.kind)).map((a): Acontecimento => ({ id: `al-${a.id}`, quando: new Date(a.createdAt), icone: 'alerta', tom: a.state !== 'aberto' ? 'soft' : a.severity === 'alta' ? 'neg' : 'warn', titulo: ROTULO_ALERTA[a.kind] ?? a.kind, detalhe: a.state === 'aberto' ? 'Alerta aberto' : 'Alerta encerrado', href: a.kind === 'coletor_parado' ? `/sites/${site.id}/instalacao` : a.kind === 'regressao_pagespeed' ? `/sites/${site.id}/velocidade` : `/sites/${site.id}/disponibilidade`, quandoTexto: quandoTexto(new Date(a.createdAt)) })),
    ...medicoes.filter((m) => m.status === 'ok').map((m): Acontecimento => ({ id: `med-${m.id}`, quando: new Date(m.measuredAt), icone: 'tendencia', tom: m.regression ? 'warn' : 'info', titulo: `PageSpeed ${m.device === 'mobile' ? 'mobile' : 'desktop'}: performance ${m.performance ?? '—'}`, detalhe: `${m.url}${m.regression ? ' · possível regressão' : ''}`, href: `/sites/${site.id}/velocidade`, quandoTexto: quandoTexto(new Date(m.measuredAt)) })),
    ...envios.map((e): Acontecimento => ({ id: `sub-${e.id}`, quando: new Date(e.occurredAt), icone: 'mensagem', tom: e.receiptStatus === 'falha_destino' ? 'neg' : 'ok', titulo: e.isNewLead ? 'Novo contato' : 'Contato enviou de novo', detalhe: `${e.contactName ?? 'sem nome'}${e.pagePath ? ` · ${e.pagePath}` : ''}${e.attribution === 'ultimo_clique' && e.botao ? ` · via ${e.botao}` : ''}`, href: `/sites/${site.id}/contatos`, quandoTexto: quandoTexto(new Date(e.occurredAt)) })),
  ].sort((a, b) => b.quando.getTime() - a.quando.getTime()).slice(0, 8);
  const s = site.situacao;
  const semWorker = !worker || workerSemSinal(worker.seenAt);
  const plataforma = PLATAFORMAS.find((p) => p.valor === site.platform)?.texto ?? site.platform;

  const recursos: { nome: string; estado: string; tom: 'ok' | 'warn' | 'neg' | 'soft'; detalhe: string; href: string }[] = [
    {
      nome: 'Disponibilidade HTTP',
      ...(site.archivedAt
        ? { estado: 'Arquivado', tom: 'soft' as const, detalhe: 'Nada é verificado num site arquivado.' }
        : !site.monitor
          ? { estado: 'Não ativado', tom: 'soft' as const, detalhe: 'Ative na edição do site para o worker verificar a cada 5 minutos.' }
          : !site.monitor.enabled
            ? { estado: 'Pausado', tom: 'soft' as const, detalhe: 'Pausado por você. Disponibilidade não é calculada.' }
            : !site.monitor.lastCheckAt
              ? semWorker
                ? { estado: 'Aguardando worker', tom: 'warn' as const, detalhe: 'Monitor ativo, mas nenhum worker em execução. Sem worker, nada é verificado.' }
                : { estado: 'Aguardando primeira checagem', tom: 'warn' as const, detalhe: `Worker visto ${dataHora(worker!.seenAt, site.timezone)}. A primeira checagem sai em instantes.` }
              : { estado: s.rotulo, tom: s.tom, detalhe: `${s.frase} Última checagem ${dataHora(site.monitor.lastCheckAt, site.timezone)}.` }),
      href: `/sites/${site.id}/disponibilidade`,
    },
    {
      nome: 'Velocidade (PageSpeed)',
      ...(!temChave
        ? { estado: 'Chave não configurada', tom: 'soft' as const, detalhe: urls.length ? `${urls.length} URL(s) escolhida(s); sem chave do Google nada é medido.` : 'Escolha até 3 URLs e configure a chave do Google.' }
        : urls.length === 0
          ? { estado: 'Nenhuma URL escolhida', tom: 'soft' as const, detalhe: 'Escolha até 3 páginas prioritárias para medir diariamente.' }
          : medicoes.length === 0
            ? { estado: 'Aguardando primeira medição', tom: 'warn' as const, detalhe: `${urls.length} URL(s) na agenda diária do worker.` }
            : medicoes.some((m) => m.regression)
              ? { estado: 'Possível regressão', tom: 'warn' as const, detalhe: 'Uma série caiu 10 pontos ou mais em relação à medição anterior. Confirme com nova medição.' }
              : medicoes.some((m) => m.status === 'erro')
                ? { estado: 'Medição com falha', tom: 'warn' as const, detalhe: 'Ao menos uma série falhou na última tentativa. Veja o motivo na aba.' }
                : { estado: `Medido ${haQuantoTempo(medicoes[0]!.measuredAt)}`, tom: 'ok' as const, detalhe: `${medicoes.length} séries (URL × dispositivo) com medição.` }),
      href: `/sites/${site.id}/velocidade`,
    },
    {
      nome: 'Visitas e botões',
      ...(eventos.ultimoEvento
        ? { estado: `Medindo · último evento ${haQuantoTempo(eventos.ultimoEvento)}`, tom: 'ok' as const, detalhe: `${eventos.visualizacoes} visualizações e ${eventos.cliques} cliques de intenção em 30 dias.` }
        : { estado: 'Coletor sem eventos', tom: 'soft' as const, detalhe: 'Instale o script e faça o teste de instalação.' }),
      href: eventos.ultimoEvento ? `/sites/${site.id}/botoes` : `/sites/${site.id}/instalacao`,
    },
    {
      nome: 'Contatos',
      ...(rastreio.formMode === 'desligado'
        ? { estado: 'Recebimento desligado', tom: 'soft' as const, detalhe: 'Ative um modo de formulário na Instalação.' }
        : eventos.contatos > 0
          ? { estado: `${eventos.contatos} recebidos em 30 dias`, tom: 'ok' as const, detalhe: `${eventos.novosLeads} novos leads · modo ${rastreio.formMode}.` }
          : { estado: 'Nenhum contato ainda', tom: 'soft' as const, detalhe: `Modo ${rastreio.formMode} configurado; nenhum envio recebido.` }),
      href: `/sites/${site.id}/contatos`,
    },
  ];

  return (
    <div className="pagina">
      <Painel kicker="situação atual" titulo={s.rotulo}>
        <p style={{ fontSize: 'var(--tipo-corpo)', color: 'var(--tx2)' }}>{s.frase}</p>
        {s.proximaAcao && (
          <p style={{ marginTop: 'var(--esp-2)' }}>
            <Link href={s.proximaAcao.href} className="botao botao-pequeno">
              {s.proximaAcao.texto}
            </Link>
          </p>
        )}
      </Painel>

      <Painel kicker="atenção necessária" titulo="Estado de cada recurso" subtitulo="Cada item mostra o estado real. Não existe um selo genérico de 'tudo configurado'.">
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)' }}>
          {recursos.map((r) => (
            <li key={r.nome} className="item-trabalho" data-tom={r.tom}>
              <SeloEstado texto={r.estado} tom={r.tom} />
              <div className="item-trabalho-texto">
                <span className="item-trabalho-titulo">{r.nome}</span>
                <span className="item-trabalho-detalhe">{r.detalhe}</span>
              </div>
              <Link href={r.href} className="botao botao-pequeno">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </Painel>

      <Painel kicker="atividade recente" titulo={acontecimentos.length ? 'Últimos acontecimentos' : 'Nada registrado ainda'} subtitulo={acontecimentos.length ? 'Incidentes, alertas, medições e contatos, do mais recente ao mais antigo.' : undefined}>
        {acontecimentos.length === 0 ? (
          <Aviso>Incidentes, alertas, medições e contatos aparecerão aqui quando existirem. Não há atividade fictícia.</Aviso>
        ) : (
          <LinhaDoTempo itens={acontecimentos} />
        )}
      </Painel>

      <Painel kicker="cadastro" titulo="Dados do projeto" acoes={<Link href={`/sites/${site.id}/editar`} className="botao botao-pequeno">Editar</Link>}>
        <dl className="definicoes">
          <dt>Cliente</dt>
          <dd>
            <Link href={`/clientes/${site.clientId}`}>{site.clienteNome}</Link>
          </dd>
          <dt>Endereço principal</dt>
          <dd className="mono">{site.primaryUrl}</dd>
          <dt>Domínio</dt>
          <dd className="mono">{site.domain}</dd>
          <dt>Fuso horário</dt>
          <dd className="mono">{site.timezone}</dd>
          <dt>Plataforma</dt>
          <dd>{plataforma}</dd>
          <dt>Identificador público</dt>
          <dd className="mono">{site.publicId}</dd>
          <dt>Cadastrado em</dt>
          <dd>{dataHora(site.createdAt, site.timezone)}</dd>
          {site.notes && (
            <>
              <dt>Notas</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{site.notes}</dd>
            </>
          )}
        </dl>
        <form action={arquivarSite} style={{ marginTop: 'var(--esp-4)' }}>
          <input type="hidden" name="id" value={site.id} />
          {site.archivedAt ? (
            <>
              <input type="hidden" name="desarquivar" value="1" />
              <button type="submit" className="botao botao-pequeno">
                Desarquivar projeto
              </button>
            </>
          ) : (
            <button type="submit" className="botao botao-pequeno botao-perigo">
              Arquivar projeto
            </button>
          )}
        </form>
      </Painel>
    </div>
  );
}
