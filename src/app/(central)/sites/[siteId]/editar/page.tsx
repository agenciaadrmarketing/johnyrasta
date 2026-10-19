import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite, listarClientes } from '@/modules/portfolio/consultas';
import { Painel } from '@/shared/ui/Painel';
import { FormularioSite } from '../../FormularioSite';

export const metadata: Metadata = { title: 'Editar site' };

export default async function PaginaEditarSite({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const clientes = await listarClientes(u.accountId);
  return (
    <div className="pagina">
      <Painel titulo="Editar cadastro" subtitulo="Mudar o endereço principal muda a URL que o monitor verifica.">
        <FormularioSite clientes={clientes} site={site} />
      </Painel>
    </div>
  );
}
