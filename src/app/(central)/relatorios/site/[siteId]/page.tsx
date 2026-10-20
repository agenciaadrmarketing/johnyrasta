import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { periodoDoRelatorio } from '@/modules/reports/periodo';
import { relatorioDoSite } from '@/modules/reports/consultas';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Aviso } from '@/shared/ui/Painel';
import { dataHora } from '@/shared/time/formato';
import { RelatorioDeSite } from '../../RelatorioDeSite';
import { BarraDoRelatorio } from '../../BarraDoRelatorio';

export const metadata: Metadata = { title: 'Relatório do site' };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PaginaRelatorioDoSite({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const q = await searchParams;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();

  // Um relógio por renderização: período e "gerado em" vêm do mesmo instante.
  const agora = new Date();
  const entrada = { dias: primeiro(q.dias), de: primeiro(q.de), ate: primeiro(q.ate) };
  const r = periodoDoRelatorio(entrada, site.timezone, agora);
  const voltarPara = `/relatorios?alvo=site:${site.id}`;

  if (!r.ok) {
    return (
      <>
        <Cabecalho kicker="Relatório" titulo={site.name} meta={`${site.clienteNome} · ${site.domain}`} />
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

  const rel = await relatorioDoSite(u.accountId, u.userId, site.id, r.periodo, agora);
  if (!rel) notFound();

  return (
    <>
      <Cabecalho
        kicker="Relatório"
        titulo={rel.cabecalho.site}
        meta={
          <>
            {rel.cabecalho.cliente} · <span className="mono">{rel.cabecalho.dominio}</span> · {rel.cabecalho.periodo.rotulo} · gerado em {dataHora(rel.cabecalho.geradoEm, rel.cabecalho.fuso)} ({rel.cabecalho.fuso})
          </>
        }
      />
      <div className="pagina">
        <BarraDoRelatorio periodo={rel.cabecalho.periodo} sites={[{ id: rel.cabecalho.siteId, nome: rel.cabecalho.site }]} voltarPara={voltarPara} />
        <RelatorioDeSite relatorio={rel} />
      </div>
    </>
  );
}
