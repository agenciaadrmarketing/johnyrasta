import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { botoes, origens, periodoDeDias, porDiaDaSemana, porHora, resumoDeEventos } from '@/modules/analytics/consultas';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { dataHora } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Botões e horários' };

const PERIODOS = [7, 30, 90] as const;
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TOM_ACAO: Record<string, 'c1' | 'c2' | 'c3' | 'c4' | 'soft'> = { whatsapp: 'c1', form: 'c2', phone: 'c3', email: 'c4', outro: 'soft' };
const ROTULO_ACAO: Record<string, string> = { whatsapp: 'WhatsApp', form: 'Formulário', phone: 'Telefone', email: 'E-mail', outro: 'Outro' };

/** Barras por hora: SVG com alternativa textual. Uma visualização responde a UMA pergunta: em que horas acontecem as ações. */
function BarrasPorHora({ dados, total }: { dados: { hora: number; cliques: number; contatos: number }[]; total: number }) {
  const max = Math.max(1, ...dados.map((d) => d.cliques + d.contatos));
  const w = 24 * 26, h = 120;
  const resumo = dados.filter((d) => d.cliques + d.contatos > 0).map((d) => `${d.hora}h: ${d.cliques} cliques, ${d.contatos} contatos`).join('; ');
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${w} ${h + 18}`} width="100%" style={{ maxWidth: w, display: 'block' }} role="img" aria-label={`Ações por hora do dia no fuso do site, ${total} ações no total. ${resumo || 'Sem ações no período.'}`}>
        {dados.map((d) => {
          const ac = (d.cliques / max) * h, ab = (d.contatos / max) * h, x = d.hora * 26 + 3;
          return (
            <g key={d.hora}>
              <rect className="grafico-barra" x={x} y={h - ac - ab} width={20} height={ac} fill="var(--c1)" opacity={0.85} />
              <rect className="grafico-barra" x={x} y={h - ab} width={20} height={ab} fill="var(--c2)" />
              <text x={x + 10} y={h + 14} textAnchor="middle" fontSize="9" fill="var(--tx3)" fontFamily="var(--fonte-mono)">{d.hora}</text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', marginTop: 'var(--esp-1)' }}>
        <span style={{ color: 'var(--c1)' }}>■</span> cliques de intenção · <span style={{ color: 'var(--c2)' }}>■</span> contatos recebidos · horas no fuso do site
      </figcaption>
    </figure>
  );
}

export default async function PaginaBotoes({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ dias?: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const { dias: d } = await searchParams;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const dias = (PERIODOS as readonly number[]).includes(Number(d)) ? Number(d) : 30;
  const p = periodoDeDias(dias);
  const [resumo, linhas, horas, semana, orig] = [
    await resumoDeEventos(u.accountId, site.id, p),
    await botoes(u.accountId, site.id, p),
    await porHora(u.accountId, site.id, site.timezone, p),
    await porDiaDaSemana(u.accountId, site.id, site.timezone, p),
    await origens(u.accountId, site.id, p),
  ];
  const totalAcoes = resumo.cliques + resumo.contatos;
  const amostraPequena = totalAcoes < 30;
  const th = (t: string, ajuda?: string) => <th key={t} scope="col" title={ajuda} style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap', cursor: ajuda ? 'help' : undefined }}>{t}</th>;
  const td = { padding: '9px 10px' } as const;

  return (
    <div className="pagina">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3)', alignItems: 'center' }}>
        <nav aria-label="Período" className="filtros">
          {PERIODOS.map((n) => <Link key={n} href={`/sites/${site.id}/botoes?dias=${n}`} className="filtro" aria-current={dias === n ? 'true' : undefined}>{n} dias</Link>)}
        </nav>
        <span style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>
          {resumo.visualizacoes} visualizações · {resumo.sessoes} sessões · {resumo.cliques} cliques de intenção · {resumo.contatos} contatos recebidos · {resumo.novosLeads} novos leads
        </span>
        <a href={`/api/exportar/eventos?site=${site.id}&dias=${dias}`} className="botao botao-pequeno" style={{ marginLeft: 'auto' }}>Exportar CSV</a>
      </div>

      {resumo.primeiroEvento === null ? (
        <EstadoVazio tom="aguardando" kicker="aguardando" icone="cursor" titulo="Nenhum evento real recebido" explicacao="Instale o coletor e faça o teste de instalação. Eventos de diagnóstico não aparecem aqui." acao={{ rotulo: 'Ir para Instalação', href: `/sites/${site.id}/instalacao` }} />
      ) : (
        <>
          {amostraPequena && <Aviso tom="warn">Amostra pequena ({totalAcoes} ações no período). Contagens são exibidas; conclusões sobre “melhor horário” ou “melhor botão” não são confiáveis com esse volume.</Aviso>}

          <Painel kicker="horários" titulo="Ações por hora do dia" subtitulo={`Hora de ocorrência de cada ação, no fuso ${site.timezone}. Contagens, não taxas.`}>
            <BarrasPorHora dados={horas} total={totalAcoes} />
            <details style={{ marginTop: 'var(--esp-3)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>Tabela por hora</summary>
              <div style={{ overflowX: 'auto', marginTop: 'var(--esp-2)' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead><tr>{['Hora', 'Visualizações', 'Cliques', 'Contatos', 'Novos leads'].map((t) => th(t))}</tr></thead>
                  <tbody>{horas.filter((x) => x.visualizacoes + x.cliques + x.contatos > 0).map((x) => <tr key={x.hora} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}><td style={td} className="mono">{String(x.hora).padStart(2, '0')}h</td><td style={td} className="mono">{x.visualizacoes}</td><td style={td} className="mono">{x.cliques}</td><td style={td} className="mono">{x.contatos}</td><td style={td} className="mono">{x.novosLeads}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          </Painel>

          <div className="grade-dupla">
            <Painel kicker="dias da semana" titulo="Ações por dia">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Dia', 'Visualizações', 'Cliques', 'Contatos'].map((t) => th(t))}</tr></thead>
                <tbody>{semana.map((x) => <tr key={x.dia} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}><td style={td}>{DIAS[x.dia]}</td><td style={td} className="mono">{x.visualizacoes}</td><td style={td} className="mono">{x.cliques}</td><td style={td} className="mono">{x.contatos}</td></tr>)}</tbody>
              </table>
            </Painel>
            <Painel kicker="origens" titulo="De onde vieram as sessões" subtitulo="UTM permitidas (source, medium, campaign) e referrer. Sem UTM e sem referrer = direto.">
              {orig.length === 0 ? <EstadoVazio icone="globo" titulo="Sem sessões no período" /> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Origem', 'Meio', 'Sessões', 'Contatos'].map((t) => th(t))}</tr></thead>
                  <tbody>{orig.map((o, i) => <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}><td style={td}>{o.source}</td><td style={td}>{o.medium ?? '—'}</td><td style={td} className="mono">{o.sessoes}</td><td style={td} className="mono">{o.contatos}</td></tr>)}</tbody>
                </table>
              )}
            </Painel>
          </div>

          <Painel kicker="botões" titulo="Cliques por botão, página e posição" subtitulo="Contatos atribuídos = submissões cujo último clique elegível (mesma sessão, até 30 min) foi este botão. Sem medição de impressões, não há CTR.">
            {linhas.length === 0 ? <EstadoVazio icone="cursor" titulo="Nenhum clique no período" explicacao="Marque botões com data-track-id; links de WhatsApp, telefone e e-mail são detectados automaticamente." /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead><tr>{[['Botão'], ['Ação'], ['Página'], ['Posição'], ['Cliques', 'Total de cliques (uma pessoa pode clicar várias vezes)'], ['Sessões com clique', 'Sessões distintas em que houve clique neste botão'], ['Contatos atribuídos', 'Submissões cujo último clique elegível foi este'], ['Sessões convertidas', 'Sessões que clicaram neste botão E tiveram contato recebido — denominador compatível'], ['Último']].map(([t, a]) => th(t!, a))}</tr></thead>
                  <tbody>
                    {linhas.map((l, i) => (
                      <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                        <td style={td} className="mono">{l.buttonId}{l.autoDetected && <> <Etiqueta texto="identificação automática" tom="soft" /></>}</td>
                        <td style={td}><Etiqueta texto={ROTULO_ACAO[l.kind] ?? l.kind} tom={TOM_ACAO[l.kind] ?? 'soft'} /></td>
                        <td style={td} className="mono">{l.path}</td>
                        <td style={td}>{l.pos ?? '—'}</td>
                        <td style={td} className="mono">{l.cliques}</td>
                        <td style={td} className="mono">{l.sessoesComClique}</td>
                        <td style={td} className="mono">{l.contatosAtribuidos}</td>
                        <td style={td} className="mono">{l.sessoesConvertidas}{l.sessoesComClique ? <span style={{ color: 'var(--tx3)' }}> ({Math.round((l.sessoesConvertidas / l.sessoesComClique) * 100)}%)</span> : null}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--tx3)' }}>{dataHora(l.ultimoClique, site.timezone)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Painel>
        </>
      )}
    </div>
  );
}
