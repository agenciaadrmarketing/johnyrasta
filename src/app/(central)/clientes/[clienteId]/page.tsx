import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarCliente, listarSites } from '@/modules/portfolio/consultas';
import { arquivarCliente } from '@/modules/portfolio/acoes';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { LinhaProjeto } from '../../sites/LinhaProjeto';
import { FormularioCliente } from '../FormularioCliente';

export const metadata: Metadata = { title: 'Cliente' };

export default async function PaginaCliente({ params }: { params: Promise<{ clienteId: string }> }) {
  const u = await exigirSessao();
  const { clienteId } = await params;
  const cliente = await buscarCliente(u.accountId, clienteId);
  if (!cliente) notFound();
  const sites = await listarSites(u.accountId, u.userId, { clienteId: cliente.id });
  const ativos = sites.filter((s) => s.archivedAt === null);
  return (
    <>
      <Cabecalho
        kicker="Cliente"
        titulo={cliente.name}
        meta={`${ativos.length} ${ativos.length === 1 ? 'site ativo' : 'sites ativos'}${cliente.archivedAt ? ' · arquivado' : ''}`}
        acoes={
          !cliente.archivedAt ? (
            <Link href={`/sites/novo?cliente=${cliente.id}`} className="botao botao-primario">
              Adicionar site
            </Link>
          ) : undefined
        }
      />
      <div className="pagina">
        <Painel kicker="projetos" titulo="Sites deste cliente">
          {ativos.length === 0 ? (
            <EstadoVazio icone="globo" titulo="Nenhum site ativo" acao={cliente.archivedAt ? undefined : { rotulo: 'Adicionar site', href: `/sites/novo?cliente=${cliente.id}` }} />
          ) : (
            <div className="lista-projetos">
              {ativos.map((s) => (
                <LinhaProjeto key={s.id} site={s} />
              ))}
            </div>
          )}
        </Painel>
        <Painel kicker="cadastro" titulo="Dados do cliente">
          <FormularioCliente cliente={cliente} />
          <form action={arquivarCliente} style={{ marginTop: 'var(--esp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)', alignItems: 'flex-start' }}>
            <input type="hidden" name="id" value={cliente.id} />
            {cliente.archivedAt ? (
              <>
                <input type="hidden" name="desarquivar" value="1" />
                <button type="submit" className="botao botao-pequeno">
                  Desarquivar cliente
                </button>
              </>
            ) : ativos.length > 0 ? (
              <Aviso>Para arquivar este cliente, arquive antes os {ativos.length} sites ativos dele.</Aviso>
            ) : (
              <button type="submit" className="botao botao-pequeno botao-perigo">
                Arquivar cliente
              </button>
            )}
          </form>
        </Painel>
      </div>
    </>
  );
}
