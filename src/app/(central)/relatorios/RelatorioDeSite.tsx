import Link from 'next/link';
import type { RelatorioDoSite } from '@/modules/reports/consultas';
import { ROTULO_CATEGORIA } from '@/modules/monitoring/consultas';
import { ROTULO_ERRO_PS } from '@/modules/performance/consultas';
import { ROTULO_RECEBIMENTO } from '@/modules/contacts/consultas';
import { LIMITE_AMOSTRA_PEQUENA, LIMITE_DE_SUBMISSOES } from '@/modules/reports/regras';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { dataHora } from '@/shared/time/formato';

/**
 * Um relatório de site, seção por seção. Componente de servidor PURO: não lê
 * relógio nem ambiente — tudo vem do objeto montado por `relatorioDoSite`.
 * Cada seção diz de onde veio o dado e o que ele não prova.
 */

const DISP = { mobile: 'Mobile', desktop: 'Desktop' } as const;
const ROTULO_ACAO: Record<string, string> = { whatsapp: 'WhatsApp', form: 'Formulário', phone: 'Telefone', email: 'E-mail', outro: 'Outro' };
const TOM_ACAO: Record<string, 'c1' | 'c2' | 'c3' | 'c4' | 'soft'> = { whatsapp: 'c1', form: 'c2', phone: 'c3', email: 'c4', outro: 'soft' };
const ROTULO_EVIDENCIA: Record<string, string> = { endpoint: 'Endpoint da central', webhook: 'Confirmação assinada do destino', auxiliar: 'Cópia do coletor' };

const th = (t: string) => (
  <th key={t} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>
    {t}
  </th>
);
const td = { padding: '9px 10px' } as const;
const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const tomDaNota = (n: number | null): 'soft' | 'ok' | 'warn' | 'neg' => (n === null ? 'soft' : n >= 90 ? 'ok' : n >= 50 ? 'warn' : 'neg');
const corDaNota = (n: number | null) => (n === null ? 'var(--tx3)' : tomDaNota(n) === 'ok' ? 'var(--c1)' : tomDaNota(n) === 'warn' ? 'var(--c3)' : 'var(--c4)');

function duracao(msTotal: number): string {
  const min = Math.round(msTotal / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

/** Rodapé de seção: de onde o número veio e o que ele não prova. */
function Fonte({ fonte, limitacao }: { fonte: string; limitacao?: string }) {
  return (
    <p style={{ marginTop: 'var(--esp-3)', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', lineHeight: 1.6 }}>
      <strong style={{ fontWeight: 'var(--peso-medio)' }}>Fonte:</strong> {fonte}
      {limitacao && (
        <>
          {' '}
          <strong style={{ fontWeight: 'var(--peso-medio)' }}>Limitação:</strong> {limitacao}
        </>
      )}
    </p>
  );
}

function Tabela({ cabecalhos, children, minWidth = 520 }: { cabecalhos: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>
        <thead>
          <tr>{cabecalhos.map(th)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function RelatorioDeSite({ relatorio: r, comTitulo = false }: { relatorio: RelatorioDoSite; comTitulo?: boolean }) {
  const c = r.cabecalho;
  const fuso = c.fuso;
  const p = c.periodo;
  const d = r.disponibilidade;
  const v = r.velocidade;
  const a = r.audiencia;
  const ac = r.acoes;
  const ct = r.contatos;
  const h = r.horarios;
  const semEventosReais = a.resumo.primeiroEvento === null;
  const janelaMaiorQueRetencao = d.checagens !== null && p.dias > 30;

  return (
    <section className="relatorio-site" aria-label={`Relatório de ${c.site}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-5)' }}>
      {comTitulo && (
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2) var(--esp-4)', alignItems: 'baseline', borderBottom: '1px solid var(--bd)', paddingBottom: 'var(--esp-3)' }}>
          <h2 className="mono" style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-leve)', letterSpacing: 'var(--trilha-justa)' }}>
            {c.site}
          </h2>
          <span className="mono" style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>
            {c.dominio}
          </span>
          <span style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx3)' }}>
            fuso {fuso} · período: {p.rotulo}
          </span>
          <Link href={`/sites/${c.siteId}`} className="nao-imprime" style={{ fontSize: 'var(--tipo-apoio)', marginLeft: 'auto' }}>
            Abrir espaço do site
          </Link>
        </header>
      )}

      {c.arquivado && <Aviso tom="warn">Site arquivado: nada é verificado nem coletado desde o arquivamento. Os números abaixo são do que existia antes.</Aviso>}

      {/* ── Disponibilidade ── */}
      <Painel kicker="disponibilidade" titulo={d.monitor ? d.estado.rotulo : 'Disponibilidade não verificada'} subtitulo={d.monitor ? d.estado.frase : undefined}>
        {!d.monitor ? (
          <EstadoVazio tom="configurar" kicker="decisão pendente" icone="relogio" titulo="Este site não tem monitor de disponibilidade" explicacao="Sem monitor não há checagem, incidente nem certificado a relatar. Ative na edição do site." />
        ) : (
          <>
            <dl className="definicoes">
              <dt>Estado atual</dt>
              <dd>
                <SeloEstado texto={d.estado.rotulo} tom={d.estado.tom} />
              </dd>
              <dt>Última checagem</dt>
              <dd>{d.monitor.ultimaChecagem ? `${dataHora(d.monitor.ultimaChecagem, fuso)} · ${d.monitor.ultimaOk ? 'respondeu' : 'falhou'}` : 'nenhuma registrada'}</dd>
              <dt>Certificado TLS</dt>
              <dd>
                {d.tls.estado === 'valido' && d.tls.expiraEm
                  ? `válido · vence em ${dataHora(d.tls.expiraEm, fuso)}`
                  : d.tls.estado === 'sem_tls'
                    ? 'endereço sem TLS (http)'
                    : d.tls.estado === 'falha'
                      ? 'falha no handshake TLS'
                      : 'ainda não verificado'}
              </dd>
              <dt>Checagens bem-sucedidas</dt>
              <dd>
                {!d.checagens || d.checagens.amostras === 0 ? (
                  <span style={{ color: 'var(--tx3)' }}>sem amostras nas últimas {d.checagens?.janelaHoras ?? p.dias * 24} h</span>
                ) : (
                  <>
                    <span className="mono">{d.checagens.percentual!.toFixed(1)}%</span> · {d.checagens.bemSucedidas} de {d.checagens.amostras} checagens nas últimas {d.checagens.janelaHoras} h
                    {d.checagens.lacunas > 0 && (
                      <>
                        {' '}
                        · <span style={{ color: 'var(--warn-tx)' }}>{d.checagens.lacunas} {d.checagens.lacunas === 1 ? 'lacuna' : 'lacunas'} de cobertura</span>
                      </>
                    )}
                  </>
                )}
              </dd>
            </dl>

            <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>Incidentes no período</h3>
            {d.incidentes.length === 0 ? (
              <EstadoVazio icone="verificar" titulo="Nenhum incidente tocou o período" explicacao={d.monitor.ultimaChecagem ? undefined : 'Também não houve checagem: o monitor ainda não foi executado pelo worker.'} />
            ) : (
              <Tabela cabecalhos={['Resultado', 'Primeira falha', 'Confirmado', 'Recuperado', 'Duração observada', 'Causa', 'Checagens']} minWidth={620}>
                {d.incidentes.map((i) => (
                  <tr key={i.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={td}>{!i.recoveredAt ? <Etiqueta texto={i.confirmedAt ? 'Aberto · confirmado' : 'Aberto · suspeita'} tom={i.confirmedAt ? 'neg' : 'warn'} /> : i.outcome === 'isolada' ? <Etiqueta texto="Falha isolada" tom="soft" /> : <Etiqueta texto="Encerrado" tom="ok" />}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataHora(i.firstFailureAt, fuso)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.confirmedAt ? dataHora(i.confirmedAt, fuso) : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.recoveredAt ? dataHora(i.recoveredAt, fuso) : 'em andamento'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }} className="mono">{duracao((i.recoveredAt ?? c.geradoEm).getTime() - i.firstFailureAt.getTime())}</td>
                    <td style={td}>{i.causeCategory ? (ROTULO_CATEGORIA[i.causeCategory] ?? i.causeCategory) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{i.failedChecks}</td>
                  </tr>
                ))}
              </Tabela>
            )}
            <Fonte
              fonte={`monitor HTTP do worker a cada ${Math.round(d.monitor.intervaloSegundos / 60)} min; incidentes que começaram antes do fim do período e não haviam terminado antes do início.`}
              limitacao={`a fração de checagens é contada a partir de agora (${d.checagens?.janelaHoras ?? p.dias * 24} h), não do início do período${janelaMaiorQueRetencao ? ', e checagens são retidas por 30 dias — a janela efetiva é menor que o período' : ''}. Não é disponibilidade contínua.`}
            />
          </>
        )}
      </Painel>

      {/* ── Velocidade ── */}
      <Painel kicker="velocidade" titulo="Última medição por página e dispositivo" subtitulo="Mobile e desktop são séries distintas. Não existe 'nota do site'.">
        {v.medicoes.length === 0 ? (
          !v.configurado ? (
            <EstadoVazio tom="aguardando" kicker="aguardando configuração" icone="tendencia" titulo="PageSpeed não configurado" explicacao={v.urlsEscolhidas ? `${v.urlsEscolhidas} URL(s) escolhida(s), mas sem a chave do Google nada é medido.` : 'Sem chave do Google e sem URL escolhida não há medição a relatar.'} />
          ) : v.urlsEscolhidas === 0 ? (
            <EstadoVazio tom="configurar" kicker="decisão pendente" icone="tendencia" titulo="Nenhuma URL escolhida para medir" explicacao="Escolha até 3 páginas na aba Velocidade." />
          ) : (
            <EstadoVazio tom="aguardando" kicker="aguardando primeira medição" icone="relogio" titulo="Sem medição ainda" explicacao={`${v.urlsEscolhidas} URL(s) na agenda diária do worker.`} />
          )
        ) : (
          <>
            {!v.configurado && <Aviso tom="warn">A chave do PageSpeed não está configurada na aplicação: as medições abaixo já existiam, mas novas medições dependem da chave.</Aviso>}
            {v.possivelRegressao && <Aviso tom="warn">Possível regressão: uma série caiu 10 pontos ou mais em relação à medição anterior. É indicação, não alerta — confirme com nova medição.</Aviso>}
            <div style={{ marginTop: v.possivelRegressao ? 'var(--esp-3)' : 0 }}>
              <Tabela cabecalhos={['Página', 'Disp.', 'Medido em', 'Estado', 'Perf.', 'Acess.', 'Práticas', 'SEO', 'LCP', 'CLS', 'TBT']} minWidth={760}>
                {v.medicoes.map((m) => (
                  <tr key={m.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="mono" title={m.url}>{m.url.replace(/^https?:\/\/(www\.)?/, '')}</td>
                    <td style={td}>{DISP[m.device]}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {dataHora(m.measuredAt, fuso)}
                      {m.measuredAt.getTime() < p.de.getTime() && <> <Etiqueta texto="anterior ao período" tom="soft" /></>}
                    </td>
                    <td style={td}>{m.status === 'ok' ? <Etiqueta texto={m.regression ? 'ok · regressão?' : 'ok'} tom={m.regression ? 'warn' : 'ok'} /> : m.status === 'parcial' ? <Etiqueta texto="parcial" tom="warn" /> : <Etiqueta texto={ROTULO_ERRO_PS[m.errorCategory ?? 'desconhecido'] ?? 'erro'} tom="neg" />}</td>
                    {[m.performance, m.accessibility, m.bestPractices, m.seo].map((n, i) => (
                      <td key={i} style={{ ...td, color: corDaNota(n) }} className="mono">{n ?? '—'}</td>
                    ))}
                    <td style={td} className="mono">{ms(m.lcpMs)}</td>
                    <td style={td} className="mono">{m.cls ?? '—'}</td>
                    <td style={td} className="mono">{ms(m.tbtMs)}</td>
                  </tr>
                ))}
              </Tabela>
            </div>
          </>
        )}

        <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>Dados de campo (CrUX)</h3>
        {v.crux.length === 0 ? (
          <EstadoVazio icone="clientes" titulo="Dados insuficientes" explicacao="O Chrome não tem amostra suficiente para estas páginas, ou ainda não houve medição. Não é zero: é ausência de dado." />
        ) : (
          <Tabela cabecalhos={['Escopo', 'Identificador', 'Disp.', 'Geral', 'LCP p75', 'INP p75', 'CLS p75', 'Coletado']} minWidth={620}>
            {v.crux.map((x, i) => (
              <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                <td style={td}><Etiqueta texto={x.scope === 'url' ? 'Página' : 'Origem'} tom={x.scope === 'url' ? 'c2' : 'soft'} /></td>
                <td style={{ ...td, overflowWrap: 'anywhere' }} className="mono">{x.identifier}</td>
                <td style={td}>{DISP[x.device]}</td>
                <td style={td}>{x.overall ?? '—'}</td>
                <td style={td} className="mono">{ms(x.lcpP75Ms)}</td>
                <td style={td} className="mono">{ms(x.inpP75Ms)}</td>
                <td style={td} className="mono">{x.clsP75 ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataHora(x.collectedAt, fuso)}</td>
              </tr>
            ))}
          </Tabela>
        )}
        <Fonte fonte="API PageSpeed Insights v5: Lighthouse (laboratório) e Chrome UX Report (campo, p75 dos últimos 28 dias). É a última medição de cada série, não uma média do período." limitacao="Lighthouse simula; CrUX mede usuários reais. INP só do campo. 'Origem' significa que a página não tinha volume e o dado é do site inteiro." />
      </Painel>

      {/* ── Audiência ── */}
      <Painel kicker="audiência" titulo="Visitas no período" subtitulo="Visualizações de página, sessões de 30 min e visitantes com identificador.">
        {semEventosReais ? (
          <EstadoVazio tom="aguardando" kicker="aguardando" icone="cursor" titulo="Nenhum evento real recebido" explicacao="O coletor ainda não enviou nada que não fosse diagnóstico. Sem instalação, não há audiência a relatar." />
        ) : (
          <>
            <dl className="definicoes">
              <dt>Visualizações</dt>
              <dd className="mono">{a.resumo.visualizacoes}</dd>
              <dt>Sessões</dt>
              <dd className="mono">{a.resumo.sessoes}</dd>
              <dt>Visitantes identificados</dt>
              <dd className="mono">{a.resumo.visitantes}</dd>
            </dl>
            <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>De onde vieram as sessões</h3>
            {a.origens.length === 0 ? (
              <EstadoVazio icone="globo" titulo="Sem sessões no período" />
            ) : (
              <Tabela cabecalhos={['Origem', 'Meio', 'Sessões', 'Contatos']} minWidth={420}>
                {a.origens.map((o, i) => (
                  <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={td}>{o.source}</td>
                    <td style={td}>{o.medium ?? '—'}</td>
                    <td style={td} className="mono">{o.sessoes}</td>
                    <td style={td} className="mono">{o.contatos}</td>
                  </tr>
                ))}
              </Tabela>
            )}
          </>
        )}
        <Fonte fonte="coletor c.v1 instalado no site; origem por UTM permitidas (source, medium, campaign) e referrer." limitacao="visitantes sem identificador (consentimento pendente) contam em sessões, não em visitantes. Bloqueadores de script reduzem a contagem." />
      </Painel>

      {/* ── Ações ── */}
      <Painel kicker="ações" titulo="Cliques de intenção por botão" subtitulo="Contatos atribuídos = envios cujo último clique elegível (mesma sessão, até 30 min) foi este botão.">
        {semEventosReais ? (
          <EstadoVazio icone="cursor" titulo="Sem eventos reais" explicacao="Cliques aparecem quando o coletor estiver instalado." />
        ) : (
          <>
            <dl className="definicoes">
              <dt>Cliques de intenção</dt>
              <dd className="mono">{ac.cliques}</dd>
              <dt>Tentativas de formulário</dt>
              <dd className="mono">{ac.tentativasForm}</dd>
            </dl>
            <div style={{ marginTop: 'var(--esp-3)' }}>
              {ac.botoes.length === 0 ? (
                <EstadoVazio icone="cursor" titulo="Nenhum clique no período" explicacao="Botões marcados com data-track-id e links de WhatsApp, telefone e e-mail detectados automaticamente." />
              ) : (
                <Tabela cabecalhos={['Botão', 'Ação', 'Página', 'Posição', 'Cliques', 'Sessões com clique', 'Contatos atribuídos', 'Sessões convertidas']} minWidth={760}>
                  {ac.botoes.map((l, i) => (
                    <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                      <td style={td} className="mono">{l.buttonId}{l.autoDetected && <> <Etiqueta texto="automático" tom="soft" /></>}</td>
                      <td style={td}><Etiqueta texto={ROTULO_ACAO[l.kind] ?? l.kind} tom={TOM_ACAO[l.kind] ?? 'soft'} /></td>
                      <td style={td} className="mono">{l.path}</td>
                      <td style={td}>{l.pos ?? '—'}</td>
                      <td style={td} className="mono">{l.cliques}</td>
                      <td style={td} className="mono">{l.sessoesComClique}</td>
                      <td style={td} className="mono">{l.contatosAtribuidos}</td>
                      <td style={td} className="mono">{l.sessoesConvertidas}</td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </div>
          </>
        )}
        <Fonte fonte="eventos de clique do coletor e atribuição ao último clique da mesma sessão." limitacao="clique em WhatsApp, telefone ou e-mail é intenção, não contato. Sem medição de impressões não há CTR." />
      </Painel>

      {/* ── Contatos ── */}
      <Painel kicker="contatos" titulo="Contatos recebidos no período" subtitulo="Envios com dados válidos persistidos. A origem da evidência diz o quanto cada um prova.">
        {ct.recebidos === 0 && ct.tentativas === 0 ? (
          <EstadoVazio icone="mensagem" titulo="Nenhum contato no período" explicacao={semEventosReais ? 'Formulários chegam pelo endpoint da central, por confirmação assinada do destino ou por cópia do coletor.' : 'Houve visitas, mas nenhum formulário com dados foi recebido.'} />
        ) : (
          <>
            <dl className="definicoes">
              <dt>Recebidos</dt>
              <dd className="mono">{ct.recebidos}</dd>
              <dt>Novos leads</dt>
              <dd className="mono">{ct.novosLeads}</dd>
              {ct.tentativas > 0 && (
                <>
                  <dt>Tentativas sem dados</dt>
                  <dd className="mono">{ct.tentativas}</dd>
                </>
              )}
            </dl>
            {ct.listaCortada && <div style={{ marginTop: 'var(--esp-3)' }}><Aviso tom="warn">A lista de envios bateu no teto de {LIMITE_DE_SUBMISSOES} do período: a tabela por evidência pode estar incompleta. Os totais acima vêm da contagem no banco e estão corretos.</Aviso></div>}
            <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>Por origem da evidência</h3>
            {ct.porEvidencia.length === 0 ? (
              <EstadoVazio icone="caixa" titulo="Só tentativas, nenhum envio com dados" />
            ) : (
              <Tabela cabecalhos={['Evidência', 'Estado', 'Envios']} minWidth={360}>
                {ct.porEvidencia.map((g, i) => {
                  const rot = ROTULO_RECEBIMENTO[g.status] ?? { texto: g.status, tom: 'soft' as const };
                  return (
                    <tr key={i} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                      <td style={td}>{ROTULO_EVIDENCIA[g.evidencia] ?? g.evidencia}</td>
                      <td style={td}><SeloEstado texto={rot.texto} tom={rot.tom} /></td>
                      <td style={td} className="mono">{g.total}</td>
                    </tr>
                  );
                })}
              </Tabela>
            )}
            {ct.recentes.length > 0 && (
              <>
                <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>Últimos {ct.recentes.length} envios (sem a mensagem)</h3>
                <Tabela cabecalhos={['Quando', 'Contato', 'Estado', 'Página', 'Atribuição', 'Campos']} minWidth={640}>
                  {ct.recentes.map((s) => {
                    const rot = ROTULO_RECEBIMENTO[s.receiptStatus] ?? { texto: s.receiptStatus, tom: 'soft' as const };
                    const campos = Object.entries(s.campos).map(([k, val]) => `${k}: ${val}`).join(' · ');
                    return (
                      <tr key={s.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataHora(s.occurredAt, fuso)}</td>
                        <td style={td}>{s.contactName ?? s.campos.email ?? s.campos.phone ?? '—'}{s.isNewLead && <> <Etiqueta texto="novo" tom="c1" /></>}</td>
                        <td style={td}><SeloEstado texto={rot.texto} tom={rot.tom} /></td>
                        <td style={td} className="mono">{s.pagePath ?? '—'}</td>
                        <td style={td}>{s.attribution === 'ultimo_clique' ? <Etiqueta texto={`último clique: ${s.botao ?? '?'}`} tom="c2" /> : <Etiqueta texto="sem atribuição" tom="soft" />}</td>
                        <td style={{ ...td, fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', overflowWrap: 'anywhere' }}>{campos || '—'}</td>
                      </tr>
                    );
                  })}
                </Tabela>
              </>
            )}
          </>
        )}
        <Fonte fonte="submissões recebidas pela central (endpoint, webhook assinado ou cópia do coletor), sem diagnósticos." limitacao="'Destino confirmado' é a única evidência de que o sistema original aceitou o envio. A mensagem livre fica fora do relatório." />
      </Painel>

      {/* ── Horários ── */}
      <Painel kicker="horários" titulo="Horas com mais ações" subtitulo={`Cliques e contatos por hora de ocorrência, no fuso ${fuso}. Contagens, não taxas.`}>
        {h.totalAcoes === 0 ? (
          <EstadoVazio icone="relogio" titulo="Sem ações no período" explicacao="Horários aparecem quando houver cliques ou contatos." />
        ) : (
          <>
            {h.amostraPequena && <div style={{ marginBottom: 'var(--esp-3)' }}><Aviso tom="warn">Amostra pequena ({h.totalAcoes} ações, abaixo de {LIMITE_AMOSTRA_PEQUENA}). As contagens são reais; “melhor horário” não é conclusão confiável com esse volume.</Aviso></div>}
            <Tabela cabecalhos={['Hora', 'Cliques', 'Contatos', 'Novos leads', 'Visualizações']} minWidth={420}>
              {h.maisAtivas.map((x) => (
                <tr key={x.hora} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                  <td style={td} className="mono">{String(x.hora).padStart(2, '0')}h</td>
                  <td style={td} className="mono">{x.cliques}</td>
                  <td style={td} className="mono">{x.contatos}</td>
                  <td style={td} className="mono">{x.novosLeads}</td>
                  <td style={td} className="mono">{x.visualizacoes}</td>
                </tr>
              ))}
            </Tabela>
          </>
        )}
        <Fonte fonte="hora de cada evento convertida para o fuso do site na consulta (UTC no banco)." limitacao={`com menos de ${LIMITE_AMOSTRA_PEQUENA} ações, a distribuição por hora é ruído. A tabela completa por hora está na aba Botões e horários.`} />
      </Painel>

      {/* ── Limitações ── */}
      <Painel kicker="leia antes de concluir" titulo="O que este relatório não afirma">
        <ul style={{ paddingLeft: 'var(--esp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)', fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', lineHeight: 1.6 }}>
          {r.limitacoes.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p style={{ marginTop: 'var(--esp-3)', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
          Gerado em {dataHora(c.geradoEm, fuso)} ({fuso}) · período: {p.rotulo} · mesmas consultas das abas do site e dos CSVs.
        </p>
      </Painel>
    </section>
  );
}
