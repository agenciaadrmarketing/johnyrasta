import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { historicoDeMedicoes, trabalhosPendentes, ultimasMedicoes, ultimoCrux, urlsDoSite, ROTULO_ERRO_PS, type Medicao } from '@/modules/performance/consultas';
import { medirAgora, removerUrl } from '@/modules/performance/acoes';
import { LIMITE_DE_URLS_POR_SITE } from '@/modules/performance/pagespeed';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';
import { FormularioUrl } from './FormularioUrl';

export const metadata: Metadata = { title: 'Velocidade' };

const tomDaNota = (n: number | null) => (n === null ? 'soft' : n >= 90 ? 'ok' : n >= 50 ? 'warn' : 'neg') as 'soft' | 'ok' | 'warn' | 'neg';
const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const DISP = { mobile: 'Mobile', desktop: 'Desktop' } as const;

function Nota({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
      <span className="mono" style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-leve)', letterSpacing: 'var(--trilha-fechada)', color: valor === null ? 'var(--tx3)' : `var(--${tomDaNota(valor) === 'ok' ? 'c1' : tomDaNota(valor) === 'warn' ? 'c3' : 'c4'})` }}>
        {valor ?? '—'}
      </span>
      <span style={{ fontSize: 'var(--tipo-micro)', color: 'var(--tx3)', letterSpacing: 'var(--trilha-media)', textTransform: 'uppercase' }}>{rotulo}</span>
    </span>
  );
}

export default async function PaginaVelocidade({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const configurado = !!process.env.PAGESPEED_API_KEY;
  const [urls, ultimas, historico, crux, pendentes] = [
    await urlsDoSite(u.accountId, site.id),
    await ultimasMedicoes(u.accountId, site.id),
    await historicoDeMedicoes(u.accountId, site.id),
    await ultimoCrux(u.accountId, site.id),
    await trabalhosPendentes(u.accountId, site.id),
  ];
  const fuso = site.timezone;
  const porUrlDisp = new Map<string, Medicao>(ultimas.map((m) => [`${m.monitoredUrlId}:${m.device}`, m]));
  const pendentePara = (id: string, d: string) => pendentes.find((p) => p.monitoredUrlId === id && p.device === d);

  return (
    <div className="pagina">
      {!configurado && (
        <Aviso tom="warn">
          <span>
            <strong>PageSpeed não configurado.</strong> Defina <code className="mono">PAGESPEED_API_KEY</code> no ambiente do worker e da aplicação. Sem a chave, nenhuma medição é agendada e nenhuma nota aparece aqui. As URLs já podem ser escolhidas.
          </span>
        </Aviso>
      )}

      <Painel kicker="o que medir" titulo={`URLs prioritárias (${urls.length} de ${LIMITE_DE_URLS_POR_SITE})`} subtitulo="Medição diária por URL e por dispositivo. Mobile e desktop são medições distintas; não existe 'nota do site'.">
        {urls.length === 0 ? (
          <EstadoVazio tom="configurar" kicker="decisão pendente" icone="tendencia" titulo="Nenhuma URL escolhida" explicacao="Escolha até 3 páginas que importam para este cliente: a inicial, a de contato, a landing da campanha." />
        ) : (
          <div className="lista-trabalho">
            {urls.map((url) => (
              <article key={url.id} className="item-trabalho" data-tom="soft" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <div className="item-trabalho-texto" style={{ gap: 'var(--esp-2)' }}>
                  <span className="item-trabalho-titulo mono" style={{ overflowWrap: 'anywhere' }}>{url.url}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-5)' }}>
                    {url.devices.map((d) => {
                      const m = porUrlDisp.get(`${url.id}:${d}`);
                      const p = pendentePara(url.id, d);
                      return (
                        <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-1)', minWidth: 0 }}>
                          <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', display: 'flex', gap: 'var(--esp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{DISP[d]}</strong>
                            {m ? <span>medido {haQuantoTempo(m.measuredAt)}</span> : <span>sem medição</span>}
                            {p && <Etiqueta texto={p.state === 'processando' ? 'medindo…' : p.attempts > 0 ? `aguardando nova tentativa (${ROTULO_ERRO_PS[p.errorCategory ?? ''] ?? p.errorCategory})` : 'na fila'} tom={p.attempts > 0 ? 'warn' : 'soft'} />}
                            {m?.regression && <Etiqueta texto="possível regressão" tom="warn" />}
                            {m?.status === 'parcial' && <Etiqueta texto="resposta parcial" tom="warn" />}
                          </span>
                          {m && m.status !== 'erro' ? (
                            <div style={{ display: 'flex', gap: 'var(--esp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <Nota rotulo="Perf." valor={m.performance} />
                              <Nota rotulo="Acess." valor={m.accessibility} />
                              <Nota rotulo="Práticas" valor={m.bestPractices} />
                              <Nota rotulo="SEO" valor={m.seo} />
                              <span className="mono" style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)' }}>LCP {ms(m.lcpMs)} · CLS {m.cls ?? '—'} · TBT {ms(m.tbtMs)}</span>
                            </div>
                          ) : m ? (
                            <SeloEstado texto={ROTULO_ERRO_PS[m.errorCategory ?? 'desconhecido'] ?? 'Falha'} tom="neg" titulo={m.errorDetail ?? undefined} />
                          ) : (
                            <SeloEstado texto={configurado ? 'Aguardando primeira medição' : 'Aguardando configuração da chave'} tom="soft" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)', alignItems: 'flex-end' }}>
                  <form action={medirAgora}>
                    <input type="hidden" name="id" value={url.id} />
                    <input type="hidden" name="site" value={site.id} />
                    <button type="submit" className="botao botao-pequeno" disabled={!configurado} title={configurado ? 'Enfileira uma medição por dispositivo (uma a cada 30 min)' : 'Exige a chave do PageSpeed'}>Medir agora</button>
                  </form>
                  <form action={removerUrl}>
                    <input type="hidden" name="id" value={url.id} />
                    <input type="hidden" name="site" value={site.id} />
                    <button type="submit" className="botao botao-pequeno botao-perigo">Remover</button>
                  </form>
                </span>
              </article>
            ))}
          </div>
        )}
        {urls.length < LIMITE_DE_URLS_POR_SITE && (
          <div style={{ marginTop: 'var(--esp-4)' }}>
            <FormularioUrl siteId={site.id} dominio={site.domain} />
          </div>
        )}
        <p style={{ marginTop: 'var(--esp-3)', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
          A nota de SEO do Lighthouse mede boas práticas técnicas da página. Não mede posicionamento, tráfego orgânico nem citações em IA.
        </p>
      </Painel>

      <Painel kicker="dados de campo (CrUX)" titulo="O que usuários reais sentiram" subtitulo="Percentil 75 dos últimos 28 dias informados pelo Google. INP vem daqui, não do laboratório. 'Origem' significa que a página não tinha volume e o dado é do site inteiro.">
        {crux.length === 0 ? (
          <EstadoVazio icone="clientes" titulo="Dados insuficientes" explicacao="O Chrome não tem amostra suficiente para estas páginas, ou ainda não houve medição. Isso não é zero: é ausência de dado." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr>{['Escopo', 'Identificador', 'Dispositivo', 'Geral', 'LCP p75', 'INP p75', 'CLS p75', 'Coletado'].map((h) => <th key={h} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {crux.map((c, i) => (
                  <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={{ padding: '9px 10px' }}><Etiqueta texto={c.scope === 'url' ? 'Página' : 'Origem'} tom={c.scope === 'url' ? 'c2' : 'soft'} /></td>
                    <td style={{ padding: '9px 10px', overflowWrap: 'anywhere' }} className="mono">{c.identifier}</td>
                    <td style={{ padding: '9px 10px' }}>{DISP[c.device]}</td>
                    <td style={{ padding: '9px 10px' }}>{c.overall ?? '—'}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{ms(c.lcpP75Ms)}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{ms(c.inpP75Ms)}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{c.clsP75 ?? '—'}</td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{dataHora(c.collectedAt, fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      <Painel kicker="diagnóstico" titulo="Oportunidades apontadas pelo Lighthouse" subtitulo="Estimativas individuais da última medição de cada série. Não são somadas: economias de auditorias diferentes se sobrepõem.">
        {ultimas.filter((m) => m.diagnostics.length).length === 0 ? (
          <EstadoVazio icone="verificar" titulo="Nenhuma oportunidade registrada" explicacao="Aparece quando houver medição com auditorias abaixo de 90." />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--esp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
            {ultimas.filter((m) => m.diagnostics.length).map((m) => (
              <div key={m.id}>
                <div style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', marginBottom: 'var(--esp-2)' }} className="mono">{m.url} · {DISP[m.device]}</div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-1)' }}>
                  {m.diagnostics.slice(0, 6).map((d) => (
                    <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--esp-3)', fontSize: 'var(--tipo-apoio)', borderBottom: '1px solid var(--rowbd)', padding: '6px 0' }}>
                      <span>{d.titulo}</span>
                      <span className="mono" style={{ color: 'var(--tx3)', whiteSpace: 'nowrap' }}>{d.economiaMs ? `~${ms(d.economiaMs)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Painel>

      <Painel kicker="histórico" titulo="Medições" subtitulo="Retidas por 12 meses. Compare só a mesma URL e o mesmo dispositivo; a variação entre medições é esperada.">
        {historico.length === 0 ? (
          <EstadoVazio tom={configurado && urls.length ? 'aguardando' : 'neutro'} kicker={configurado && urls.length ? 'aguardando' : undefined} icone="relogio" titulo="Nenhuma medição ainda" explicacao={configurado ? 'A agenda diária do worker enfileira cada URL × dispositivo; a primeira medição aparece aqui.' : 'Sem chave do PageSpeed não há medição.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>{['Quando', 'URL', 'Disp.', 'Estado', 'Perf.', 'Acess.', 'Práticas', 'SEO', 'LCP', 'CLS', 'TBT', 'Lighthouse'].map((h) => <th key={h} scope="col" style={{ textAlign: 'left', padding: '9px 8px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {historico.map((m) => (
                  <tr key={m.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{dataHora(m.measuredAt, fuso)}</td>
                    <td style={{ padding: '8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="mono" title={m.url}>{m.url.replace(/^https?:\/\/(www\.)?/, '')}</td>
                    <td style={{ padding: '8px' }}>{DISP[m.device]}</td>
                    <td style={{ padding: '8px' }}>{m.status === 'ok' ? <Etiqueta texto={m.regression ? 'ok · regressão?' : 'ok'} tom={m.regression ? 'warn' : 'ok'} /> : m.status === 'parcial' ? <Etiqueta texto="parcial" tom="warn" /> : <Etiqueta texto={ROTULO_ERRO_PS[m.errorCategory ?? 'desconhecido'] ?? 'erro'} tom="neg" />}</td>
                    {[m.performance, m.accessibility, m.bestPractices, m.seo].map((v, i) => <td key={i} style={{ padding: '8px', color: v === null ? 'var(--tx3)' : `var(--${tomDaNota(v) === 'ok' ? 'c1' : tomDaNota(v) === 'warn' ? 'c3' : 'c4'})` }} className="mono">{v ?? '—'}</td>)}
                    <td style={{ padding: '8px' }} className="mono">{ms(m.lcpMs)}</td>
                    <td style={{ padding: '8px' }} className="mono">{m.cls ?? '—'}</td>
                    <td style={{ padding: '8px' }} className="mono">{ms(m.tbtMs)}</td>
                    <td style={{ padding: '8px', color: 'var(--tx3)' }} className="mono">{m.lighthouseVersion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
      <p style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
        Estado da integração e da fila em <Link href="/configuracoes#sistema">Configurações</Link>.
      </p>
    </div>
  );
}
