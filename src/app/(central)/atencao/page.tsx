import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { estadoDoWorker, listarSites, workerSemSinal } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Aviso } from '@/shared/ui/Painel';
import { haQuantoTempo } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Atenção' };

/**
 * Lista de trabalho: o que precisa de ação, em ordem de gravidade. Vem da
 * mesma função de situação que a linha de projeto usa — nunca discordam.
 */
export default async function PaginaAtencao() {
  const u = await exigirSessao();
  const [sites, worker] = [await listarSites(u.accountId, u.userId, { filtro: 'atencao' }), await estadoDoWorker(u.accountId)];
  const workerAtrasado = !worker || workerSemSinal(worker.seenAt);

  return (
    <>
      <Cabecalho kicker="Lista de trabalho" titulo="Atenção" meta={`${sites.length} ${sites.length === 1 ? 'item' : 'itens'}`} />
      <div className="pagina">
        {workerAtrasado && (
          <Aviso tom="warn">
            <span>
              <strong>Worker {worker ? `sem sinal ${haQuantoTempo(worker.seenAt)}` : 'nunca visto'}.</strong> Enquanto ele não roda, nenhum site é
              verificado e esta lista não reflete a situação real dos sites. <Link href="/configuracoes#sistema">Ver estado do sistema</Link>
            </span>
          </Aviso>
        )}
        {sites.length === 0 ? (
          <EstadoVazio
            icone="verificar"
            titulo="Nenhuma ação pendente"
            explicacao="Incidentes confirmados, verificações atrasadas, certificados próximos do vencimento e decisões de configuração aparecem aqui."
          />
        ) : (
          <div className="lista-trabalho" data-testid="lista-trabalho">
            {sites.map((s) => (
              <article key={s.id} className="item-trabalho" data-tom={s.situacao.tom === 'ok' ? 'soft' : s.situacao.tom}>
                <SeloEstado texto={s.situacao.rotulo} tom={s.situacao.tom} />
                <div className="item-trabalho-texto">
                  <span className="item-trabalho-titulo">
                    <Link href={`/sites/${s.id}`} style={{ color: 'inherit' }}>
                      {s.name}
                    </Link>{' '}
                    <span style={{ color: 'var(--tx3)', fontWeight: 'var(--peso-leve)' }}>· {s.clienteNome}</span>
                  </span>
                  <span className="item-trabalho-detalhe">{s.situacao.frase}</span>
                </div>
                {s.situacao.proximaAcao && (
                  <Link href={s.situacao.proximaAcao.href} className="botao botao-pequeno">
                    {s.situacao.proximaAcao.texto}
                  </Link>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
