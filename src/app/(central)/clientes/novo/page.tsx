import type { Metadata } from 'next';
import { exigirSessao } from '@/modules/accounts/contexto';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel } from '@/shared/ui/Painel';
import { FormularioCliente } from '../FormularioCliente';

export const metadata: Metadata = { title: 'Novo cliente' };

export default async function PaginaNovoCliente({ searchParams }: { searchParams: Promise<{ depois?: string }> }) {
  await exigirSessao();
  const { depois } = await searchParams;
  return (
    <>
      <Cabecalho kicker="Clientes" titulo="Novo cliente" />
      <div className="pagina">
        <Painel titulo="Dados do cliente">
          <FormularioCliente depois={depois === 'site' ? 'site' : undefined} />
        </Painel>
      </div>
    </>
  );
}
