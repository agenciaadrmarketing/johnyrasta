import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite, estadoDoWorker } from '@/modules/portfolio/consultas';
import { arquivarSite } from '@/modules/portfolio/acoes';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { PLATAFORMAS } from '@/shared/validation/site';
import { dataHora } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Resumo do site' };

/**
 * Resumo: situação atual, o que precisa de atenção e os fatos do cadastro.
 * Cada recurso aparece com o estado REAL: "aguardando worker", "não
 * configurado", "aguardando primeira medição". Nunca "tudo configurado".
 */
export default async function PaginaResumo({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const worker = await estadoDoWorker(u.accountId);
  const s = site.situacao;
  const plataforma = PLATAFORMAS.find((p) => p.valor === site.platform)?.texto ?? site.platform;

  const recursos: { nome: string; estado: string; tom: 'ok' | 'warn' | 'neg' | 'soft'; detalhe: string; href: string }[] = [
    {
      nome: 'Disponibilidade HTTP',
      ...(site.archivedAt
        ? { estado: 'Arquivado', tom: 'soft' as const, detalhe: 'Nada é verificado num site arquivado.' }
        : !site.monitor
          ? { estado: 'Não ativado', tom: 'soft' as const, detalhe: 'Ative na edição do site para o worker verificar a cada 5 minutos.' }
          : !site.monitor.enabled
            ? { estado: 'Pausado', tom: 'soft' as const, detalhe: 'Pausado por você. Disponibilidade não é calculada.' }
            : worker
              ? { estado: 'Aguardando primeira checagem', tom: 'warn' as const, detalhe: `Worker visto ${dataHora(worker.seenAt, site.timezone)}. A primeira checagem ainda não foi registrada (Fase 2).` }
              : { estado: 'Aguardando worker', tom: 'warn' as const, detalhe: 'Monitor ativo, mas nenhum worker se apresentou ainda. Sem worker, nada é verificado.' }),
      href: `/sites/${site.id}/disponibilidade`,
    },
    { nome: 'Velocidade (PageSpeed)', estado: 'Não configurado', tom: 'soft', detalhe: 'Selecione até 3 URLs e configure a chave do Google (Fase 3).', href: `/sites/${site.id}/velocidade` },
    { nome: 'Visitas e botões', estado: 'Coletor não instalado', tom: 'soft', detalhe: 'O script de coleta e o teste de instalação chegam na Fase 4.', href: `/sites/${site.id}/instalacao` },
    { nome: 'Contatos', estado: 'Sem recebimento', tom: 'soft', detalhe: 'Endpoint de formulário e integração confirmada chegam na Fase 4.', href: `/sites/${site.id}/contatos` },
  ];

  return (
    <div className="pagina">
      <Painel kicker="situação atual" titulo={s.rotulo}>
        <p style={{ fontSize: 'var(--tipo-corpo)', color: 'var(--tx2)' }}>{s.frase}</p>
        {s.proximaAcao && (
          <p style={{ marginTop: 'var(--esp-2)' }}>
            <Link href={s.proximaAcao.href} className="botao botao-pequeno">
              {s.proximaAcao.texto}
            </Link>
          </p>
        )}
      </Painel>

      <Painel kicker="atenção necessária" titulo="Estado de cada recurso" subtitulo="Cada item mostra o estado real. Não existe um selo genérico de 'tudo configurado'.">
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)' }}>
          {recursos.map((r) => (
            <li key={r.nome} className="item-trabalho" data-tom={r.tom}>
              <SeloEstado texto={r.estado} tom={r.tom} />
              <div className="item-trabalho-texto">
                <span className="item-trabalho-titulo">{r.nome}</span>
                <span className="item-trabalho-detalhe">{r.detalhe}</span>
              </div>
              <Link href={r.href} className="botao botao-pequeno">
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      </Painel>

      <Painel kicker="atividade recente" titulo="Nada registrado ainda">
        <Aviso>Incidentes, medições e contatos aparecerão aqui quando existirem. Não há atividade fictícia.</Aviso>
      </Painel>

      <Painel kicker="cadastro" titulo="Dados do projeto" acoes={<Link href={`/sites/${site.id}/editar`} className="botao botao-pequeno">Editar</Link>}>
        <dl className="definicoes">
          <dt>Cliente</dt>
          <dd>
            <Link href={`/clientes/${site.clientId}`}>{site.clienteNome}</Link>
          </dd>
          <dt>Endereço principal</dt>
          <dd className="mono">{site.primaryUrl}</dd>
          <dt>Domínio</dt>
          <dd className="mono">{site.domain}</dd>
          <dt>Fuso horário</dt>
          <dd className="mono">{site.timezone}</dd>
          <dt>Plataforma</dt>
          <dd>{plataforma}</dd>
          <dt>Identificador público</dt>
          <dd className="mono">{site.publicId}</dd>
          <dt>Cadastrado em</dt>
          <dd>{dataHora(site.createdAt, site.timezone)}</dd>
          {site.notes && (
            <>
              <dt>Notas</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{site.notes}</dd>
            </>
          )}
        </dl>
        <form action={arquivarSite} style={{ marginTop: 'var(--esp-4)' }}>
          <input type="hidden" name="id" value={site.id} />
          {site.archivedAt ? (
            <>
              <input type="hidden" name="desarquivar" value="1" />
              <button type="submit" className="botao botao-pequeno">
                Desarquivar projeto
              </button>
            </>
          ) : (
            <button type="submit" className="botao botao-pequeno botao-perigo">
              Arquivar projeto
            </button>
          )}
        </form>
      </Painel>
    </div>
  );
}
