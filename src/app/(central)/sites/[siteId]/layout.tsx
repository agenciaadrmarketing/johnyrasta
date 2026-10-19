import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Icone } from '@/shared/ui/icones';
import { haQuantoTempo } from '@/shared/time/formato';
import { Abas } from './Abas';

/**
 * Espaço do site: cabeçalho com nome, cliente, domínio, estado, última
 * verificação e "Abrir site"; abas abaixo. Um id de outra conta é 404.
 */
export default async function LayoutSite({ children, params }: { children: React.ReactNode; params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const s = site.situacao;
  return (
    <>
      <Cabecalho
        kicker={site.clienteNome}
        titulo={site.name}
        meta={
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
            <span className="mono">{site.domain}</span>
            <SeloEstado texto={s.rotulo} tom={s.tom} />
            <span>{s.verificadoEm ? `verificado ${haQuantoTempo(s.verificadoEm)}` : 'sem checagem registrada'}</span>
          </span>
        }
        acoes={
          <>
            <Link href={`/sites/${site.id}/editar`} className="botao">
              Editar
            </Link>
            <a href={site.primaryUrl} target="_blank" rel="noopener noreferrer" className="botao">
              Abrir site <Icone nome="externo" tamanho={13} />
            </a>
          </>
        }
      />
      <Abas siteId={site.id} />
      {children}
    </>
  );
}
