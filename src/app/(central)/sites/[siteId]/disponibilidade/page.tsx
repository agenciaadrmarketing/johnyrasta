import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite, estadoDoWorker, workerSemSinal } from '@/modules/portfolio/consultas';
import { historicoDeAlertas, incidentesDoSite, resumoDeChecagens, ultimasChecagens, ROTULO_ALERTA, ROTULO_CATEGORIA } from '@/modules/monitoring/consultas';
import { definirManutencao, pausarOuRetomar, verificarAgora } from '@/modules/monitoring/acoes';
import { emailLigadoParaOSite, preferenciasDeNotificacao } from '@/modules/notifications/consultas';
import { alternarEmailDoSite } from '@/modules/notifications/acoes';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Disponibilidade' };

function duracao(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export default async function PaginaDisponibilidade({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const m = site.monitor;
  const s = site.situacao;
  const fuso = site.timezone;

  if (!m) {
    return (
      <div className="pagina">
        <EstadoVazio
          tom="configurar"
          kicker="decisão pendente"
          icone="relogio"
          titulo="Disponibilidade não é verificada neste site"
          explicacao="Ative o monitoramento na edição do site. O worker passa a verificar o endereço principal a cada 5 minutos com conexão segura e confirma falha em duas checagens seguidas."
          acao={{ rotulo: 'Ativar monitoramento', href: `/sites/${site.id}/editar` }}
        />
      </div>
    );
  }

  const [checagens, incidentes, r24, r7d, alertas, worker, emailDoSite, prefsEmail] = [
    await ultimasChecagens(u.accountId, site.id),
    await incidentesDoSite(u.accountId, site.id),
    await resumoDeChecagens(u.accountId, site.id, 24),
    await resumoDeChecagens(u.accountId, site.id, 24 * 7),
    await historicoDeAlertas(u.accountId, site.id),
    await estadoDoWorker(u.accountId),
    await emailLigadoParaOSite(u.accountId, site.id),
    await preferenciasDeNotificacao(u.accountId),
  ];
  // Um relógio só por renderização: o componente de servidor é puro em relação a ele.
  const agora = new Date();
  const semWorker = !worker || workerSemSinal(worker.seenAt, agora);
  const emManutencao = !!m.maintenanceUntil && m.maintenanceUntil > agora;
  const cooldownAtivo = !!m.manualRequestedAt && agora.getTime() - m.manualRequestedAt.getTime() < 2 * 60 * 1000;

  const tls =
    m.tlsState === 'valido' && m.tlsExpiresAt
      ? (() => {
          const dias = Math.floor((m.tlsExpiresAt.getTime() - agora.getTime()) / 86_400_000);
          return { texto: dias < 0 ? 'Certificado vencido' : `Certificado válido · vence em ${dias} ${dias === 1 ? 'dia' : 'dias'} (${dataHora(m.tlsExpiresAt, fuso)})`, tom: dias < 0 ? ('neg' as const) : dias <= 14 ? ('warn' as const) : ('ok' as const) };
        })()
      : m.tlsState === 'sem_tls'
        ? { texto: 'Endereço sem TLS (http)', tom: 'warn' as const }
        : m.tlsState === 'falha'
          ? { texto: 'Falha no handshake TLS: sem data de expiração', tom: 'neg' as const }
          : { texto: 'Ainda não verificado', tom: 'soft' as const };

  return (
    <div className="pagina">
      {semWorker && (
        <Aviso tom="warn">
          <span>
            <strong>Worker {worker ? `sem sinal ${haQuantoTempo(worker.seenAt)}` : 'nunca visto'}.</strong> As informações abaixo param de se atualizar enquanto ele não roda.{' '}
            <Link href="/configuracoes#sistema">Ver estado do sistema</Link>
          </span>
        </Aviso>
      )}

      <Painel
        kicker="agora"
        titulo={s.rotulo}
        subtitulo={s.frase}
        acoes={
          <>
            <form action={verificarAgora}>
              <input type="hidden" name="site" value={site.id} />
              <button type="submit" className="botao botao-pequeno" disabled={!m.enabled || cooldownAtivo} title={cooldownAtivo ? 'Aguarde dois minutos entre verificações manuais' : 'Coloca este site na frente da fila do worker'}>
                {cooldownAtivo ? 'Verificação pedida' : 'Verificar agora'}
              </button>
            </form>
            <form action={pausarOuRetomar}>
              <input type="hidden" name="site" value={site.id} />
              {m.enabled ? (
                <button type="submit" className="botao botao-pequeno">Pausar monitor</button>
              ) : (
                <>
                  <input type="hidden" name="retomar" value="1" />
                  <button type="submit" className="botao botao-pequeno">Retomar monitor</button>
                </>
              )}
            </form>
          </>
        }
      >
        <dl className="definicoes">
          <dt>Última checagem</dt>
          <dd>{m.lastCheckAt ? <>{dataHora(m.lastCheckAt, fuso)} · {haQuantoTempo(m.lastCheckAt)} · {m.lastOk ? 'respondeu' : 'falhou'}</> : 'nenhuma registrada'}</dd>
          <dt>Próxima prevista</dt>
          <dd>{m.enabled ? (m.nextCheckAt ? dataHora(m.nextCheckAt, fuso) : 'assim que o worker pegar') : 'monitor pausado'}</dd>
          <dt>Intervalo</dt>
          <dd>a cada {Math.round(m.intervalSeconds / 60)} min · falha confirmada após 2 checagens seguidas ({Math.round(m.intervalSeconds / 60)} a {Math.round(m.intervalSeconds / 30)} min, mais atrasos da infraestrutura)</dd>
          <dt>URL verificada</dt>
          <dd className="mono">{site.primaryUrl}</dd>
          <dt>Certificado TLS</dt>
          <dd><SeloEstado texto={tls.texto} tom={tls.tom} /></dd>
          <dt>Manutenção</dt>
          <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
            {emManutencao ? <SeloEstado texto={`até ${dataHora(m.maintenanceUntil!, fuso)} · alertas suprimidos`} tom="soft" /> : <span style={{ color: 'var(--tx3)' }}>nenhuma janela ativa</span>}
            <form action={definirManutencao} style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center' }}>
              <input type="hidden" name="site" value={site.id} />
              {emManutencao ? (
                <>
                  <input type="hidden" name="horas" value="0" />
                  <button type="submit" className="botao botao-pequeno">Encerrar manutenção</button>
                </>
              ) : (
                <>
                  <label className="apenas-leitor" htmlFor="horas">Horas de manutenção</label>
                  <select id="horas" name="horas" defaultValue="2" className="botao botao-pequeno" style={{ paddingRight: 24 }}>
                    {[1, 2, 4, 8, 24].map((h) => <option key={h} value={h}>{h} h</option>)}
                  </select>
                  <button type="submit" className="botao botao-pequeno">Iniciar manutenção</button>
                </>
              )}
            </form>
          </dd>
        </dl>
      </Painel>

      <Painel kicker="amostras" titulo="Checagens bem-sucedidas no período" subtitulo="É a fração das amostras que respondeu — não equivale a disponibilidade contínua. Lacunas indicam períodos sem checagem.">
        <dl className="definicoes">
          {[r24, r7d].map((r) => (
            <div key={r.janelaHoras} style={{ display: 'contents' }}>
              <dt>{r.janelaHoras === 24 ? 'Últimas 24 h' : 'Últimos 7 dias'}</dt>
              <dd>
                {r.amostras === 0 ? (
                  <span style={{ color: 'var(--tx3)' }}>sem amostras</span>
                ) : (
                  <>
                    <span className="mono">{r.percentual!.toFixed(1)}%</span> · {r.bemSucedidas} de {r.amostras} checagens
                    {r.lacunas > 0 && <> · <span style={{ color: 'var(--warn-tx)' }}>{r.lacunas} {r.lacunas === 1 ? 'lacuna' : 'lacunas'} de cobertura</span></>}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Painel>

      <Painel kicker="histórico" titulo="Incidentes" subtitulo="Horários observados pelo monitor: primeira falha, confirmação e primeira recuperação. O instante exato da queda não é conhecido.">
        {incidentes.length === 0 ? (
          <EstadoVazio icone="verificar" titulo="Nenhum incidente registrado" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Resultado', 'Primeira falha', 'Confirmado', 'Recuperado', 'Duração observada', 'Causa', 'Checagens'].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incidentes.map((i) => (
                  <tr key={i.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={{ padding: '9px 10px' }}>
                      {!i.recoveredAt ? <Etiqueta texto={i.confirmedAt ? 'Aberto · confirmado' : 'Aberto · suspeita'} tom={i.confirmedAt ? 'neg' : 'warn'} /> : i.outcome === 'isolada' ? <Etiqueta texto="Falha isolada" tom="soft" /> : <Etiqueta texto="Encerrado" tom="ok" />}
                    </td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{dataHora(i.firstFailureAt, fuso)}</td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{i.confirmedAt ? dataHora(i.confirmedAt, fuso) : '—'}</td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{i.recoveredAt ? dataHora(i.recoveredAt, fuso) : 'em andamento'}</td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }} className="mono">{duracao((i.recoveredAt ?? agora).getTime() - i.firstFailureAt.getTime())}</td>
                    <td style={{ padding: '9px 10px' }}>{i.causeCategory ? ROTULO_CATEGORIA[i.causeCategory] ?? i.causeCategory : '—'}{i.causeDetail ? <span style={{ color: 'var(--tx3)' }}> · {i.causeDetail}</span> : null}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right' }} className="mono">{i.failedChecks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      <Painel kicker="últimas 50" titulo="Checagens recentes" subtitulo="Retidas por 30 dias. Duração é o tempo até os cabeçalhos da resposta final.">
        {checagens.length === 0 ? (
          <EstadoVazio tom={semWorker ? 'aguardando' : 'neutro'} kicker={semWorker ? 'aguardando worker' : undefined} icone="relogio" titulo="Nenhuma checagem registrada" explicacao={semWorker ? 'O worker ainda não se apresentou. Inicie-o para começar a verificar.' : 'A primeira checagem acontece assim que o worker pegar este monitor na fila.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr>
                  {['Quando', 'Resultado', 'HTTP', 'Duração', 'Redirecionamentos', 'Detalhe'].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checagens.map((c) => (
                  <tr key={c.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>{dataHora(c.checkedAt, fuso)}</td>
                    <td style={{ padding: '9px 10px' }}>{c.ok ? <Etiqueta texto="Respondeu" tom="ok" /> : <Etiqueta texto={ROTULO_CATEGORIA[c.errorCategory ?? 'desconhecido'] ?? 'Falha'} tom="neg" />}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{c.httpStatus ?? '—'}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{c.durationMs != null ? `${c.durationMs} ms` : '—'}</td>
                    <td style={{ padding: '9px 10px' }} className="mono">{c.redirects}</td>
                    <td style={{ padding: '9px 10px', color: 'var(--tx3)', fontSize: 'var(--tipo-apoio)' }}>{c.errorDetail ?? (c.finalUrl && c.finalUrl !== site.primaryUrl ? `→ ${c.finalUrl}` : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      {alertas.length > 0 && (
        <Painel kicker="alertas" titulo="Alertas deste site">
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)' }}>
            {alertas.map((a) => (
              <li key={a.id} className="item-trabalho" data-tom={a.state !== 'aberto' ? 'soft' : a.severity === 'alta' ? 'neg' : a.severity === 'media' ? 'warn' : 'soft'}>
                <SeloEstado texto={a.state === 'aberto' ? 'Aberto' : a.state === 'silenciado' ? 'Silenciado' : 'Resolvido'} tom={a.state === 'aberto' ? (a.severity === 'alta' ? 'neg' : 'warn') : 'soft'} />
                <div className="item-trabalho-texto">
                  <span className="item-trabalho-titulo">{ROTULO_ALERTA[a.kind] ?? a.kind}</span>
                  <span className="item-trabalho-detalhe">{dataHora(a.createdAt, fuso)}{a.resolvedAt ? ` · encerrado ${dataHora(a.resolvedAt, fuso)}` : ''}</span>
                </div>
                <span />
              </li>
            ))}
          </ul>
        </Painel>
      )}

      <Painel
        kicker="e-mail"
        titulo="Notificações deste site"
        subtitulo="Vale só para os alertas deste site. Quem recebe e quais tipos chegam ficam em Configurações."
        acoes={
          <form action={alternarEmailDoSite}>
            <input type="hidden" name="site" value={site.id} />
            <input type="hidden" name="ligar" value={emailDoSite ? '0' : '1'} />
            <button type="submit" className="botao botao-pequeno">{emailDoSite ? 'Desligar e-mail para este site' : 'Ligar e-mail para este site'}</button>
          </form>
        }
      >
        <dl className="definicoes">
          <dt>Este site</dt>
          <dd><SeloEstado texto={emailDoSite ? 'E-mail ligado' : 'E-mail desligado'} tom={emailDoSite ? 'ok' : 'soft'} /></dd>
          <dt>Na conta</dt>
          <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
            {prefsEmail.emailEnabled ? (
              <SeloEstado texto={`Ligado · ${prefsEmail.recipients.length} ${prefsEmail.recipients.length === 1 ? 'destinatário' : 'destinatários'}`} tom="ok" />
            ) : (
              <SeloEstado texto="Desligado: nada é enviado, mesmo com este site ligado" tom="soft" />
            )}
            <Link href="/configuracoes#notificacoes" style={{ fontSize: 'var(--tipo-apoio)' }}>Configurações → Notificações</Link>
          </dd>
        </dl>
      </Painel>
    </div>
  );
}
