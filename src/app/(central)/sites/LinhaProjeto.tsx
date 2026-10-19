import Link from 'next/link';
import type { SiteComSituacao } from '@/modules/portfolio/consultas';
import { alternarFavorito } from '@/modules/portfolio/acoes';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Icone } from '@/shared/ui/icones';
import { iniciaisDoSite } from '@/shared/validation/site';
import { haQuantoTempo } from '@/shared/time/formato';

/**
 * Uma linha por site: iniciais, nome e cliente, domínio, estado com TEXTO,
 * "verificado há…", a frase de situação e as ações. Nenhum número de KPI.
 */
export function LinhaProjeto({ site }: { site: SiteComSituacao }) {
  const s = site.situacao;
  return (
    <article className="linha-projeto" data-testid="linha-projeto" data-estado={s.estado}>
      <span className="projeto-iniciais mono" aria-hidden="true">
        {iniciaisDoSite(site.name)}
      </span>

      <div className="projeto-corpo">
        <div className="projeto-titulo">
          <Link href={`/sites/${site.id}`} className="projeto-nome">
            {site.name}
          </Link>
          <span className="projeto-cliente">{site.clienteNome}</span>
          <span className="projeto-dominio mono">{site.domain}</span>
        </div>
        <div className="projeto-situacao">
          <SeloEstado texto={s.rotulo} tom={s.tom} />
          <span>
            {s.verificadoEm ? `verificado ${haQuantoTempo(s.verificadoEm)}` : 'sem checagem registrada'}
          </span>
          <span aria-hidden="true">·</span>
          <span>{s.frase}</span>
          {s.proximaAcao && (
            <Link href={s.proximaAcao.href} style={{ fontSize: 'var(--tipo-apoio)' }}>
              {s.proximaAcao.texto} →
            </Link>
          )}
        </div>
      </div>

      <div className="projeto-acoes">
        <form action={alternarFavorito}>
          <input type="hidden" name="id" value={site.id} />
          <button
            type="submit"
            className="botao botao-pequeno"
            aria-pressed={site.favorito}
            aria-label={site.favorito ? `Remover ${site.name} dos favoritos` : `Marcar ${site.name} como favorito`}
            style={{ color: site.favorito ? 'var(--gold-tx)' : undefined }}
          >
            <Icone nome="estrela" tamanho={14} />
          </button>
        </form>
        <a href={site.primaryUrl} target="_blank" rel="noopener noreferrer" className="botao botao-pequeno">
          Visitar site <Icone nome="externo" tamanho={13} />
        </a>
        <Link href={`/sites/${site.id}`} className="botao botao-pequeno">
          Abrir projeto
        </Link>
      </div>
    </article>
  );
}
