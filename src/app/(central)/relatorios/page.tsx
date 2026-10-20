import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { listarClientes, listarSites } from '@/modules/portfolio/consultas';
import { DIAS_PADRAO, queryDoPeriodo } from '@/modules/reports/periodo';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Campo } from '@/shared/ui/Formulario';

export const metadata: Metadata = { title: 'Relatórios' };

const ALVO = /^(site|cliente):([0-9a-f-]{36})$/i;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Seleção: cliente OU site, período padrão (7/30/90) ou personalizado. O
 * formulário é GET; esta página só traduz `alvo=site:<id>` na rota do
 * relatório, preservando o período. Sites e clientes também aparecem como
 * links diretos (30 dias).
 */
export default async function PaginaRelatorios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirSessao();
  const q = await searchParams;
  const alvo = primeiro(q.alvo) ?? '';
  const entrada = { dias: primeiro(q.dias), de: primeiro(q.de), ate: primeiro(q.ate) };

  const m = ALVO.exec(alvo);
  if (m) redirect(`/relatorios/${m[1]!.toLowerCase()}/${m[2]}${queryDoPeriodo(entrada)}`);

  const [clientes, sites] = [await listarClientes(u.accountId), await listarSites(u.accountId, u.userId)];
  const alvoInvalido = alvo !== '' && !m;

  return (
    <>
      <Cabecalho kicker="Relatórios" titulo="Relatórios" meta="por site ou por cliente, num período; impresso pelo navegador" />
      <div className="pagina">
        {sites.length === 0 ? (
          <EstadoVazio
            tom="configurar"
            kicker="começando"
            icone="relatorio"
            titulo={clientes.length ? 'Cadastre um site antes' : 'Cadastre clientes e sites antes'}
            explicacao="O relatório usa as mesmas consultas das abas do site: disponibilidade, velocidade, visitas, cliques e contatos. Sem site cadastrado não há o que relatar — e não haverá números de exemplo."
            acao={clientes.length ? { rotulo: 'Adicionar site', href: '/sites/novo' } : { rotulo: 'Cadastrar cliente', href: '/clientes/novo?depois=site' }}
          />
        ) : (
          <>
            <Painel kicker="gerar" titulo="Escolha o alvo e o período" subtitulo="Período padrão é uma janela que termina agora, igual à das abas e dos CSVs. Período personalizado usa dias de calendário no fuso do site.">
              {alvoInvalido && <div style={{ marginBottom: 'var(--esp-3)' }}><Aviso tom="neg">Alvo inválido. Escolha um site ou um cliente da lista.</Aviso></div>}
              <form method="get" action="/relatorios" style={{ display: 'grid', gap: 'var(--esp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', alignItems: 'end' }}>
                <Campo nome="alvo" rotulo="Relatório de">
                  <select name="alvo" defaultValue={m ? alvo : ''} required>
                    <option value="" disabled>
                      Escolha um site ou cliente
                    </option>
                    <optgroup label="Clientes (todos os sites ativos)">
                      {clientes.map((c) => (
                        <option key={c.id} value={`cliente:${c.id}`}>
                          {c.name} · {c.totalSites} {c.totalSites === 1 ? 'site' : 'sites'}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Sites">
                      {sites
                        .filter((s) => s.archivedAt === null)
                        .map((s) => (
                          <option key={s.id} value={`site:${s.id}`}>
                            {s.name} · {s.domain}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </Campo>
                <Campo nome="dias" rotulo="Período">
                  <select name="dias" defaultValue={entrada.de || entrada.ate ? 'personalizado' : (entrada.dias ?? '30')}>
                    {DIAS_PADRAO.map((d) => (
                      <option key={d} value={d}>
                        últimos {d} dias
                      </option>
                    ))}
                    <option value="personalizado">personalizado (datas abaixo)</option>
                  </select>
                </Campo>
                <Campo nome="de" rotulo="Início (se personalizado)" type="date" defaultValue={entrada.de ?? ''} dica="00:00 no fuso do site" />
                <Campo nome="ate" rotulo="Fim (se personalizado)" type="date" defaultValue={entrada.ate ?? ''} dica="23:59 no fuso do site · até 366 dias" />
                <div>
                  <button type="submit" className="botao botao-primario">
                    Gerar relatório
                  </button>
                </div>
              </form>
            </Painel>

            <div className="grade-dupla">
              <Painel kicker="atalhos" titulo="Por site" subtitulo="Últimos 30 dias. O período pode ser trocado dentro do relatório.">
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-1)' }}>
                  {sites
                    .filter((s) => s.archivedAt === null)
                    .map((s) => (
                      <li key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2) var(--esp-3)', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--rowbd)' }}>
                        <Link href={`/relatorios/site/${s.id}?dias=30`} style={{ fontWeight: 'var(--peso-medio)' }}>
                          {s.name}
                        </Link>
                        <span className="mono" style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
                          {s.domain}
                        </span>
                        <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', marginLeft: 'auto' }}>{s.clienteNome}</span>
                      </li>
                    ))}
                </ul>
              </Painel>
              <Painel kicker="atalhos" titulo="Por cliente" subtitulo="Um relatório por site ativo do cliente, com quebra de página entre eles na impressão.">
                {clientes.length === 0 ? (
                  <EstadoVazio icone="clientes" titulo="Nenhum cliente" />
                ) : (
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-1)' }}>
                    {clientes.map((c) => (
                      <li key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2) var(--esp-3)', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--rowbd)' }}>
                        <Link href={`/relatorios/cliente/${c.id}?dias=30`} style={{ fontWeight: 'var(--peso-medio)' }}>
                          {c.name}
                        </Link>
                        <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', marginLeft: 'auto' }}>
                          {c.totalSites} {c.totalSites === 1 ? 'site ativo' : 'sites ativos'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Painel>
            </div>
          </>
        )}
      </div>
    </>
  );
}
