import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { listarClientes } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Avatar } from '@/shared/ui/Avatar';
import { Icone } from '@/shared/ui/icones';

export const metadata: Metadata = { title: 'Clientes' };

export default async function PaginaClientes({ searchParams }: { searchParams: Promise<{ arquivados?: string }> }) {
  const u = await exigirSessao();
  const { arquivados } = await searchParams;
  const incluir = arquivados === '1';
  const clientes = await listarClientes(u.accountId, incluir);
  return (
    <>
      <Cabecalho
        kicker="Carteira"
        titulo="Clientes"
        meta={<Link href={incluir ? '/clientes' : '/clientes?arquivados=1'}>{incluir ? 'ocultar arquivados' : 'mostrar arquivados'}</Link>}
        acoes={
          <Link href="/clientes/novo" className="botao botao-primario">
            <Icone nome="mais" tamanho={14} /> Novo cliente
          </Link>
        }
      />
      <div className="pagina">
        {clientes.length === 0 ? (
          <EstadoVazio tom="configurar" kicker="começando" icone="clientes" titulo="Nenhum cliente ainda" explicacao="Clientes agrupam os sites. Cadastre o primeiro e, em seguida, o site dele." acao={{ rotulo: 'Cadastrar cliente', href: '/clientes/novo?depois=site' }} />
        ) : (
          <div className="lista-projetos">
            {clientes.map((c) => (
              <article key={c.id} className="linha-projeto" data-testid="linha-cliente">
                <Avatar nome={c.name} tamanho={40} />
                <div className="projeto-corpo">
                  <div className="projeto-titulo">
                    <Link href={`/clientes/${c.id}`} className="projeto-nome">
                      {c.name}
                    </Link>
                    {c.archivedAt && <span className="projeto-cliente">arquivado</span>}
                  </div>
                  <div className="projeto-situacao">
                    <span>
                      {c.totalSites} {c.totalSites === 1 ? 'site ativo' : 'sites ativos'}
                    </span>
                    {c.notes && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{c.notes}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="projeto-acoes">
                  <Link href={`/sites?cliente=${c.id}`} className="botao botao-pequeno">
                    Ver sites
                  </Link>
                  <Link href={`/clientes/${c.id}`} className="botao botao-pequeno">
                    Abrir
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
