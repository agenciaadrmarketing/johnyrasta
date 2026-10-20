import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarCliente } from '@/modules/portfolio/consultas';
import { periodoDoRelatorio } from '@/modules/reports/periodo';
import { fusosDoCliente, relatorioDoCliente } from '@/modules/reports/consultas';
import { FUSO_PADRAO } from '@/shared/validation/site';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Aviso } from '@/shared/ui/Painel';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { dataHora } from '@/shared/time/formato';
import { RelatorioDeSite } from '../../RelatorioDeSite';
import { BarraDoRelatorio } from '../../BarraDoRelatorio';

export const metadata: Metadata = { title: 'Relatório do cliente' };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Relatório do cliente: cabeçalho + um relatório por site ativo, com quebra
 * de página entre eles na impressão. As datas de um período personalizado
 * são interpretadas no fuso do primeiro site; se os sites usam fusos
 * diferentes, a tela avisa em vez de fingir que são iguais.
 */
export default async function PaginaRelatorioDoCliente({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirSessao();
  const { clienteId } = await params;
  const q = await searchParams;
  const cliente = await buscarCliente(u.accountId, clienteId);
  if (!cliente) notFound();
  const fusos = await fusosDoCliente(u.accountId, u.userId, cliente.id);
  const fusoReferencia = fusos[0] ?? FUSO_PADRAO;

  const agora = new Date();
  const entrada = { dias: primeiro(q.dias), de: primeiro(q.de), ate: primeiro(q.ate) };
  const r = periodoDoRelatorio(entrada, fusoReferencia, agora);
  const voltarPara = `/relatorios?alvo=cliente:${cliente.id}`;

  if (!r.ok) {
    return (
      <>
        <Cabecalho kicker="Relatório" titulo={cliente.name} />
        <div className="pagina">
          <Aviso tom="neg">
            <span>
              {r.erro} <Link href={voltarPara}>Escolher outro período</Link>
            </span>
          </Aviso>
        </div>
      </>
    );
  }

  const rel = await relatorioDoCliente(u.accountId, u.userId, cliente.id, r.periodo, agora);
  if (!rel) notFound();

  return (
    <>
      <Cabecalho
        kicker="Relatório"
        titulo={rel.cabecalho.cliente}
        meta={
          <>
            {rel.cabecalho.sitesAtivos} {rel.cabecalho.sitesAtivos === 1 ? 'site ativo' : 'sites ativos'} · {rel.cabecalho.periodo.rotulo} · gerado em {dataHora(rel.cabecalho.geradoEm, fusoReferencia)} ({fusoReferencia})
          </>
        }
      />
      <div className="pagina">
        <BarraDoRelatorio periodo={rel.cabecalho.periodo} sites={rel.sites.map((s) => ({ id: s.cabecalho.siteId, nome: s.cabecalho.site }))} voltarPara={voltarPara} />

        {fusos.length > 1 && (
          <Aviso tom="warn">
            Os sites deste cliente usam fusos diferentes ({fusos.join(', ')}). As datas do período foram interpretadas no fuso {fusoReferencia}; os horários de cada seção continuam no fuso do próprio site.
          </Aviso>
        )}

        {rel.sites.length === 0 ? (
          <EstadoVazio icone="globo" titulo="Este cliente não tem site ativo" explicacao="Sites arquivados ficam fora do relatório do cliente. Para ver um site arquivado, abra o relatório dele diretamente." acao={cliente.archivedAt ? undefined : { rotulo: 'Adicionar site', href: `/sites/novo?cliente=${cliente.id}` }} />
        ) : (
          rel.sites.map((s, i) => (
            <div key={s.cabecalho.siteId} className={i > 0 ? 'quebra-de-pagina' : undefined}>
              <RelatorioDeSite relatorio={s} comTitulo />
            </div>
          ))
        )}
      </div>
    </>
  );
}
