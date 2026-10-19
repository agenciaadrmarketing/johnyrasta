import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { contagensDeFiltros, filtroValido, listarSites, listarClientes, type FiltroDeSites } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Icone } from '@/shared/ui/icones';
import { LinhaProjeto } from './LinhaProjeto';

export const metadata: Metadata = { title: 'Meus sites' };

const FILTROS: { chave: FiltroDeSites; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'atencao', rotulo: 'Precisam de atenção' },
  { chave: 'favoritos', rotulo: 'Favoritos' },
  { chave: 'arquivados', rotulo: 'Arquivados' },
];

/**
 * A entrada da central: busca, filtros e uma linha por projeto. Sem cartões
 * de totais, sem gráficos. Ordem: incidentes e atrasos, depois decisões
 * pendentes, depois o resto.
 */
export default async function PaginaSites({ searchParams }: { searchParams: Promise<{ q?: string; filtro?: string; cliente?: string }> }) {
  const u = await exigirSessao();
  const { q = '', filtro: f, cliente } = await searchParams;
  const filtro = filtroValido(f);
  const [sites, contagens, clientes] = [
    await listarSites(u.accountId, u.userId, { busca: q, filtro, clienteId: cliente && /^[0-9a-f-]{36}$/i.test(cliente) ? cliente : undefined }),
    await contagensDeFiltros(u.accountId, u.userId),
    await listarClientes(u.accountId),
  ];
  const clienteFiltrado = cliente ? clientes.find((c) => c.id === cliente) : undefined;
  const parametros = (mudancas: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = { q, filtro, cliente, ...mudancas };
    for (const [k, v] of Object.entries(base)) if (v && !(k === 'filtro' && v === 'todos')) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <>
      <Cabecalho
        kicker="Central"
        titulo="Meus sites"
        meta={clienteFiltrado ? <>cliente: {clienteFiltrado.name} · <Link href={parametros({ cliente: undefined })}>limpar</Link></> : undefined}
        acoes={
          <Link href="/sites/novo" className="botao botao-primario">
            <Icone nome="mais" tamanho={14} /> Adicionar site
          </Link>
        }
      />
      <div className="pagina">
        <form method="get" action="/sites" role="search" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3)', alignItems: 'center' }}>
          <div className="barra-busca">
            <label htmlFor="busca" className="apenas-leitor">
              Buscar por site, cliente ou domínio
            </label>
            <input id="busca" name="q" type="search" defaultValue={q} placeholder="Buscar por site, cliente ou domínio" autoComplete="off" />
            {filtro !== 'todos' && <input type="hidden" name="filtro" value={filtro} />}
            {cliente && <input type="hidden" name="cliente" value={cliente} />}
            <button type="submit" className="botao">
              <Icone nome="busca" tamanho={14} /> Buscar
            </button>
          </div>
          <nav aria-label="Filtros" className="filtros">
            {FILTROS.map((fi) => (
              <Link key={fi.chave} href={parametros({ filtro: fi.chave })} className="filtro" aria-current={filtro === fi.chave ? 'true' : undefined}>
                {fi.rotulo}
                <span className="filtro-contagem mono">{contagens[fi.chave]}</span>
              </Link>
            ))}
          </nav>
        </form>

        {sites.length === 0 ? (
          contagens.todos === 0 && filtro === 'todos' && !q ? (
            <EstadoVazio
              tom="configurar"
              kicker="começando"
              icone="globo"
              titulo="Nenhum site cadastrado ainda"
              explicacao="Cadastre o primeiro site entregue: cliente, endereço, fuso e plataforma. O monitoramento de disponibilidade passa a valer quando o worker estiver em execução."
              acao={{ rotulo: clientes.length ? 'Adicionar site' : 'Cadastrar o primeiro cliente', href: clientes.length ? '/sites/novo' : '/clientes/novo?depois=site' }}
            />
          ) : (
            <EstadoVazio
              icone="busca"
              titulo={q ? `Nada encontrado para "${q}"` : filtro === 'atencao' ? 'Nenhum site precisa de atenção agora' : filtro === 'favoritos' ? 'Nenhum favorito ainda' : 'Nenhum site arquivado'}
              explicacao={filtro === 'atencao' ? 'Atenção lista incidentes, verificações atrasadas e decisões pendentes. Nada aqui é bom sinal — desde que o worker esteja em execução.' : undefined}
            />
          )
        ) : (
          <div className="lista-projetos" data-testid="lista-projetos">
            {sites.map((s) => (
              <LinhaProjeto key={s.id} site={s} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
