import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { conflitosAbertos, listarContatos, listarSubmissoes, ROTULO_RECEBIMENTO } from '@/modules/contacts/consultas';
import { resolverConflito } from '@/modules/analytics/acoes';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Icone } from '@/shared/ui/icones';
import { dataHora } from '@/shared/time/formato';

export const metadata: Metadata = { title: 'Contatos' };

export default async function PaginaContatos({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ q?: string; contato?: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const { q = '', contato } = await searchParams;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const [contatos, submissoes, conflitos] = [
    await listarContatos(u.accountId, site.id, { busca: q }),
    await listarSubmissoes(u.accountId, site.id, { contactId: contato && /^[0-9a-f-]{36}$/i.test(contato) ? contato : undefined, limite: 100 }),
    await conflitosAbertos(u.accountId, site.id),
  ];
  const fuso = site.timezone;
  const th = (t: string) => <th key={t} scope="col" style={{ textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>{t}</th>;
  const td = { padding: '9px 10px' } as const;

  return (
    <div className="pagina">
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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
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
                    <td style={td}><Link href={`/sites/${site.id}/contatos?contato=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="botao botao-pequeno">Envios</Link></td>
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
                  return (
                    <tr key={s.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataHora(s.occurredAt, fuso)}</td>
                      <td style={td}>{s.contactName ?? s.fields.email ?? s.fields.phone ?? '—'}</td>
                      <td style={td}><SeloEstado texto={r.texto} tom={r.tom} /></td>
                      <td style={{ ...td, fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>{s.evidenceSource}</td>
                      <td style={td} className="mono">{s.pagePath ?? '—'}</td>
                      <td style={td}>{s.attribution === 'ultimo_clique' ? <Etiqueta texto={`último clique: ${s.botao ?? '?'}`} tom="c2" /> : <Etiqueta texto="sem atribuição" tom="soft" />}</td>
                      <td style={td}>{s.isNewLead ? <Etiqueta texto="novo" tom="c1" /> : ''}</td>
                      <td style={{ ...td, fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`).join(' · ')}>
                        {Object.entries(s.fields).filter(([k]) => k !== 'message').map(([k, v]) => `${k}: ${v}`).join(' · ')}
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
    </div>
  );
}
