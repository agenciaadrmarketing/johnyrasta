import type { Metadata } from 'next';
import { exigirSessao } from '@/modules/accounts/contexto';
import { listarClientes } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel } from '@/shared/ui/Painel';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { FormularioSite } from '../FormularioSite';

export const metadata: Metadata = { title: 'Adicionar site' };

export default async function PaginaNovoSite({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const u = await exigirSessao();
  const { cliente } = await searchParams;
  const clientes = await listarClientes(u.accountId);
  return (
    <>
      <Cabecalho kicker="Meus sites" titulo="Adicionar site" />
      <div className="pagina">
        {clientes.length === 0 ? (
          <EstadoVazio
            tom="configurar"
            kicker="antes do site"
            icone="clientes"
            titulo="Cadastre um cliente primeiro"
            explicacao="Todo site pertence a um cliente. É assim que a central agrupa os projetos e que os relatórios sabem para quem são."
            acao={{ rotulo: 'Cadastrar cliente', href: '/clientes/novo?depois=site' }}
          />
        ) : (
          <Painel titulo="Dados do site" subtitulo="Só o essencial para começar. Velocidade, instalação do coletor e formulários ficam no espaço do site.">
            <FormularioSite clientes={clientes} clienteInicial={cliente} />
          </Painel>
        )}
      </div>
    </>
  );
}
