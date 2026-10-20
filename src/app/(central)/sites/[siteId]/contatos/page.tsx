import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { conflitosAbertos, listarContatos, listarSubmissoes, ROTULO_RECEBIMENTO } from '@/modules/contacts/consultas';
import { resolverConflito } from '@/modules/analytics/acoes';
import { excluirContato, salvarRetencao } from '@/modules/contacts/acoes';
import { lerPoliticaDeRetencao } from '@/modules/contacts/retencao';
import { comConta } from '@/shared/db';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Icone } from '@/shared/ui/icones';
import { dataHora } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Contatos' };

/** Retorno das ações desta aba, por querystring: a página é um componente de servidor sem estado. */
const AVISOS: Record<string, { texto: string; tom: 'ok' | 'neg' }> = {
  excluido: { texto: 'Contato excluído: nome, e-mail e telefone foram removidos. Os envios continuam contados, sem os campos.', tom: 'ok' },
  retencao_salva: { texto: 'Política de retenção salva. A automática é aplicada pelo worker, de hora em hora.', tom: 'ok' },
  retencao_invalida: { texto: 'Política não salva: para a automática, informe um prazo entre 30 e 3650 dias.', tom: 'neg' },
};

export default async function PaginaContatos({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ q?: string; contato?: string; aviso?: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const { q = '', contato, aviso } = await searchParams;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const [contatos, submissoes, conflitos, retencao] = [
    await listarContatos(u.accountId, site.id, { busca: q }),
    await listarSubmissoes(u.accountId, site.id, { contactId: contato && /^[0-9a-f-]{36}$/i.test(contato) ? contato : undefined, limite: 100 }),
    await conflitosAbertos(u.accountId, site.id),
    await comConta(u.accountId, (db) => lerPoliticaDeRetencao(db, site.id)),
  ];
  const fuso = site.timezone;
  const retorno = aviso ? AVISOS[aviso] : undefined;
  const th = (t: string) => <th key={t} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>{t}</th>;
  const td = { padding: '9px 10px' } as const;

  return (
    <div className="pagina">
      {retorno && <Aviso tom={retorno.tom}>{retorno.texto}</Aviso>}

      {conflitos.length > 0 && (
        <Painel kicker="atenção" titulo={`${conflitos.length} ${conflitos.length === 1 ? 'conflito de identidade' : 'conflitos de identidade'}`} subtitulo="O e-mail aponta para um contato e o telefone para outro. Nada foi mesclado sozinho. Decida.">
          <div className="lista-trabalho">
            {conflitos.map((k) => (
              <article key={k.id} className="item-trabalho" data-tom="warn">
                <SeloEstado texto="Conflito" tom="warn" />
                <div className="item-trabalho-texto">
                  <span className="item-trabalho-titulo">{k.email} → {k.emailNome ?? 'sem nome'} · {k.phone} → {k.phoneNome ?? 'sem nome'}</span>
                  <span className="item-trabalho-detalhe">{dataHora(k.createdAt, fuso)} · a submissão ficou com o contato do e-mail</span>
                </div>
                <span style={{ display: 'inline-flex', gap: 'var(--esp-2)' }}>
                  <form action={resolverConflito}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="site" value={site.id} /><input type="hidden" name="decisao" value="mesma_pessoa" /><button type="submit" className="botao botao-pequeno">Mesma pessoa (mesclar)</button></form>
                  <form action={resolverConflito}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="site" value={site.id} /><input type="hidden" name="decisao" value="pessoas_diferentes" /><button type="submit" className="botao botao-pequeno">Pessoas diferentes</button></form>
                </span>
              </article>
            ))}
          </div>
        </Painel>
      )}

      <Painel
        kicker="contatos"
        titulo={`${contatos.length} ${contatos.length === 1 ? 'contato' : 'contatos'}`}
        subtitulo="Pessoas reconciliadas por e-mail e telefone normalizados. Diagnósticos não entram."
        acoes={
          <>
            <form method="get" className="barra-busca" style={{ flex: '0 1 320px' }}>
              <label htmlFor="q" className="apenas-leitor">Buscar contato</label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Nome, e-mail ou telefone" />
              <button type="submit" className="botao botao-pequeno"><Icone nome="busca" tamanho={13} /></button>
            </form>
            <a href={`/api/exportar/contatos?site=${site.id}`} className="botao botao-pequeno">Exportar CSV</a>
          </>
        }
      >
        {contatos.length === 0 ? (
          <EstadoVazio tom={q ? 'neutro' : 'aguardando'} kicker={q ? undefined : 'aguardando'} icone="mensagem" titulo={q ? `Nada para "${q}"` : 'Nenhum contato recebido'} explicacao={q ? undefined : 'Contatos aparecem quando um formulário é recebido pelo endpoint, confirmado pelo destino ou copiado pelo coletor. Veja a aba Instalação.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>{['Nome', 'E-mail', 'Telefone', 'Primeiro contato real', 'Último', 'Envios', ''].map(th)}</tr></thead>
              <tbody>
                {contatos.map((c) => (
                  <tr key={c.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)', background: contato === c.id ? 'var(--hover)' : undefined }}>
                    <td style={td}>{c.name ?? <span style={{ color: 'var(--tx3)' }}>sem nome</span>}{c.conflitos > 0 && <> <Etiqueta texto="conflito" tom="warn" /></>}</td>
                    <td style={td} className="mono">{c.email ?? '—'}</td>
                    <td style={td} className="mono">{c.phone ?? '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.firstRealAt ? dataHora(c.firstRealAt, fuso) : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.lastRealAt ? dataHora(c.lastRealAt, fuso) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{c.submissoes}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Link href={`/sites/${site.id}/contatos?contato=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="botao botao-pequeno">Envios</Link>
                        {/* Dois passos sem JavaScript: abrir e confirmar lendo o que acontece. */}
                        <details>
                          <summary className="botao botao-pequeno botao-perigo" style={{ listStyle: 'none' }}>Excluir</summary>
                          <div style={{ marginTop: 'var(--esp-2)', padding: 'var(--esp-3)', border: '1px solid var(--bd)', borderRadius: 'var(--raio-m)', background: 'var(--elev)', maxWidth: 320, fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', lineHeight: 1.5 }}>
                            <p>Remove nome, e-mail e telefone desta pessoa e apaga os campos dos {c.submissoes === 1 ? 'seu envio' : `seus ${c.submissoes} envios`}. Os envios continuam contados, com data, página e atribuição. Não dá para desfazer; exporte o CSV antes, se precisar.</p>
                            <form action={excluirContato} style={{ marginTop: 'var(--esp-2)' }}>
                              <input type="hidden" name="site" value={site.id} />
                              <input type="hidden" name="id" value={c.id} />
                              <button type="submit" className="botao botao-pequeno botao-perigo">Excluir (anonimiza)</button>
                            </form>
                          </div>
                        </details>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Painel>

      <Painel kicker="recebimentos" titulo={contato ? 'Envios deste contato' : 'Últimos envios'} subtitulo="Cada envio mostra de onde veio a evidência: endpoint da central, confirmação assinada do destino ou cópia do coletor." acoes={contato ? <Link href={`/sites/${site.id}/contatos`} className="botao botao-pequeno">Ver todos</Link> : undefined}>
        {submissoes.length === 0 ? (
          <EstadoVazio icone="caixa" titulo="Nenhum envio" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>{['Quando', 'Contato', 'Estado', 'Evidência', 'Página', 'Atribuição', 'Novo lead', 'Campos'].map(th)}</tr></thead>
              <tbody>
                {submissoes.map((s) => {
                  const r = ROTULO_RECEBIMENTO[s.receiptStatus] ?? { texto: s.receiptStatus, tom: 'soft' as const };
                  const campos = Object.entries(s.fields);
                  return (
                    <tr key={s.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataHora(s.occurredAt, fuso)}</td>
                      <td style={td}>{s.contactName ?? s.fields.email ?? s.fields.phone ?? <span style={{ color: 'var(--tx3)' }}>{s.contactId ? 'contato excluído' : '—'}</span>}</td>
                      <td style={td}><SeloEstado texto={r.texto} tom={r.tom} /></td>
                      <td style={{ ...td, fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>{s.evidenceSource}</td>
                      <td style={td} className="mono">{s.pagePath ?? '—'}</td>
                      <td style={td}>{s.attribution === 'ultimo_clique' ? <Etiqueta texto={`último clique: ${s.botao ?? '?'}`} tom="c2" /> : <Etiqueta texto="sem atribuição" tom="soft" />}</td>
                      <td style={td}>{s.isNewLead ? <Etiqueta texto="novo" tom="c1" /> : ''}</td>
                      <td style={{ ...td, fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={campos.map(([k, v]) => `${k}: ${v}`).join(' · ')}>
                        {campos.length === 0 ? 'campos removidos' : campos.filter(([k]) => k !== 'message').map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 'var(--esp-3)' }}>
          <Aviso>“Contato recebido” significa dados válidos persistidos aqui. “Destino confirmado” é a única evidência de que o sistema original aceitou o envio. Clique em WhatsApp é intenção, não contato.</Aviso>
        </div>
      </Painel>

      <Painel
        kicker="retenção"
        titulo="Retenção de contatos"
        subtitulo="Por quanto tempo este site guarda nome, e-mail e telefone de quem entrou em contato. Decisão do proprietário do site, não da central."
        id="retencao"
      >
        <dl className="definicoes" style={{ marginBottom: 'var(--esp-4)' }}>
          <dt>Política atual</dt>
          <dd>
            <SeloEstado texto={retencao.policy === 'dias' ? `Automática · ${retencao.dias} dias` : 'Manual'} tom="soft" />
            <span style={{ marginLeft: 'var(--esp-2)', color: 'var(--tx2)', fontSize: 'var(--tipo-apoio)' }}>
              {retencao.policy === 'dias'
                ? `Contatos sem envio real há mais de ${retencao.dias} dias são anonimizados pelo worker, de hora em hora.`
                : 'Os contatos ficam até alguém excluir, um a um, nesta aba.'}
            </span>
          </dd>
        </dl>
        <form action={salvarRetencao} className="formulario" style={{ maxWidth: 'none' }}>
          <input type="hidden" name="site" value={site.id} />
          <div className="grade-campos">
            <label className="campo">
              Política
              <select name="policy" defaultValue={retencao.policy}>
                <option value="manual">Manual: manter até eu excluir</option>
                <option value="dias">Automática: anonimizar N dias após o último contato real</option>
              </select>
              <span className="campo-dica">Anonimizar remove nome, e-mail, telefone e os campos dos envios. Contagens, datas e atribuições ficam.</span>
            </label>
            <label className="campo">
              Prazo, em dias (30 a 3650)
              <input name="dias" type="number" min={30} max={3650} step={1} inputMode="numeric" defaultValue={retencao.dias ?? 365} />
              <span className="campo-dica">Só vale para a política automática. Conta a partir do último envio real da pessoa.</span>
            </label>
          </div>
          <Aviso>
            A exportação CSV desta aba existe para antes de excluir: depois de anonimizado, o dado pessoal não volta. A política automática depende do worker em execução (estado em Configurações); com ele parado, nada é anonimizado até voltar.
          </Aviso>
          <div className="formulario-acoes">
            <button type="submit" className="botao botao-primario">Salvar política</button>
          </div>
        </form>
      </Painel>
    </div>
  );
}
