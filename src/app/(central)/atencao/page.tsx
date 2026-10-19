import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { estadoDoWorker, listarSites, workerSemSinal } from '@/modules/portfolio/consultas';
import { alertasAbertos, ROTULO_ALERTA } from '@/modules/monitoring/consultas';
import { resolverAlerta } from '@/modules/monitoring/acoes';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { haQuantoTempo } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Atenção' };

/**
 * Lista de trabalho: alertas abertos (persistidos pelo worker, deduplicados
 * por episódio) e, abaixo, decisões pendentes de configuração. Vem das mesmas
 * funções da linha de projeto — nunca discordam.
 */
export default async function PaginaAtencao() {
  const u = await exigirSessao();
  const [alertas, sites, worker] = [
    await alertasAbertos(u.accountId),
    await listarSites(u.accountId, u.userId, { filtro: 'atencao' }),
    await estadoDoWorker(u.accountId),
  ];
  const workerAtrasado = !worker || workerSemSinal(worker.seenAt);
  // Sites cuja próxima ação é um incidente já aparecem como alerta; aqui ficam as decisões.
  const decisoes = sites.filter((s) => !['indisponivel', 'suspeita', 'verificacao_atrasada'].includes(s.situacao.estado));
  const total = alertas.length + decisoes.length;

  return (
    <>
      <Cabecalho kicker="Lista de trabalho" titulo="Atenção" meta={`${total} ${total === 1 ? 'item' : 'itens'}`} />
      <div className="pagina">
        {workerAtrasado && (
          <Aviso tom="warn">
            <span>
              <strong>Worker {worker ? `sem sinal ${haQuantoTempo(worker.seenAt)}` : 'nunca visto'}.</strong> Enquanto ele não roda, nenhum site é verificado,
              nenhum alerta novo é gerado e esta lista não reflete a situação real dos sites. <Link href="/configuracoes#sistema">Ver estado do sistema</Link>
            </span>
          </Aviso>
        )}

        <Painel kicker="alertas abertos" titulo={alertas.length ? `${alertas.length} ${alertas.length === 1 ? 'alerta' : 'alertas'}` : 'Nenhum alerta aberto'} subtitulo="Um alerta por episódio. Resolver marca como visto; silenciar guarda sem reabrir.">
          {alertas.length === 0 ? (
            <EstadoVazio icone="verificar" titulo="Nenhum alerta aberto" explicacao="Incidentes confirmados, recuperações, verificações atrasadas e certificados próximos do vencimento aparecem aqui assim que o worker os registra." />
          ) : (
            <div className="lista-trabalho" data-testid="lista-alertas">
              {alertas.map((a) => (
                <article key={a.id} className="item-trabalho" data-tom={a.severity === 'alta' ? 'neg' : a.severity === 'media' ? 'warn' : 'soft'}>
                  <SeloEstado texto={ROTULO_ALERTA[a.kind] ?? a.kind} tom={a.severity === 'alta' ? 'neg' : a.severity === 'media' ? 'warn' : 'ok'} />
                  <div className="item-trabalho-texto">
                    <span className="item-trabalho-titulo">
                      {a.siteId ? <Link href={`/sites/${a.siteId}/disponibilidade`} style={{ color: 'inherit' }}>{a.title}</Link> : a.title}
                    </span>
                    <span className="item-trabalho-detalhe">{haQuantoTempo(a.createdAt)}</span>
                  </div>
                  <span style={{ display: 'inline-flex', gap: 'var(--esp-2)' }}>
                    <form action={resolverAlerta}>
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="botao botao-pequeno">Resolver</button>
                    </form>
                    <form action={resolverAlerta}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="silenciar" value="1" />
                      <button type="submit" className="botao botao-pequeno">Silenciar</button>
                    </form>
                  </span>
                </article>
              ))}
            </div>
          )}
        </Painel>

        <Painel kicker="decisões pendentes" titulo={decisoes.length ? `${decisoes.length} ${decisoes.length === 1 ? 'site precisa' : 'sites precisam'} de uma decisão` : 'Nenhuma decisão pendente'}>
          {decisoes.length === 0 ? (
            <EstadoVazio icone="globo" titulo="Todos os sites têm monitor decidido e checagem registrada" />
          ) : (
            <div className="lista-trabalho" data-testid="lista-trabalho">
              {decisoes.map((s) => (
                <article key={s.id} className="item-trabalho" data-tom={s.situacao.tom === 'ok' ? 'soft' : s.situacao.tom}>
                  <SeloEstado texto={s.situacao.rotulo} tom={s.situacao.tom} />
                  <div className="item-trabalho-texto">
                    <span className="item-trabalho-titulo">
                      <Link href={`/sites/${s.id}`} style={{ color: 'inherit' }}>{s.name}</Link>{' '}
                      <span style={{ color: 'var(--tx3)', fontWeight: 'var(--peso-leve)' }}>· {s.clienteNome}</span>
                    </span>
                    <span className="item-trabalho-detalhe">{s.situacao.frase}</span>
                  </div>
                  {s.situacao.proximaAcao && (
                    <Link href={s.situacao.proximaAcao.href} className="botao botao-pequeno">{s.situacao.proximaAcao.texto}</Link>
                  )}
                </article>
              ))}
            </div>
          )}
        </Painel>
      </div>
    </>
  );
}
