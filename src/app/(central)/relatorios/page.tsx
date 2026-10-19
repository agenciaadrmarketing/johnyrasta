import type { Metadata } from 'next';
import { exigirSessao } from '@/modules/accounts/contexto';
import { listarClientes } from '@/modules/portfolio/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Relatórios' };

/** Fase 5. A tela existe e diz o que falta — não há relatório de números inexistentes. */
export default async function PaginaRelatorios() {
  const u = await exigirSessao();
  const clientes = await listarClientes(u.accountId);
  return (
    <>
      <Cabecalho kicker="Período e cliente" titulo="Relatórios" />
      <div className="pagina">
        <EstadoVazio
          tom="aguardando"
          kicker="aguardando dados"
          icone="relatorio"
          titulo={clientes.length ? 'Ainda não há medições para relatar' : 'Cadastre clientes e sites antes'}
          explicacao="O relatório por cliente, site e período (incidentes, notas de velocidade, visitas, cliques e contatos) usa as mesmas consultas das telas e vem na Fase 5, com CSV e versão para impressão. Sem medição, não há relatório — e não haverá números de exemplo."
          acao={clientes.length ? undefined : { rotulo: 'Cadastrar cliente', href: '/clientes/novo?depois=site' }}
        />
      </div>
    </>
  );
}
