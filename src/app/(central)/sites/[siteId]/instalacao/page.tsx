import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { diagnosticoAtual, eventosDeTeste, rastreamentoDoSite, resumoDeEventos, periodoDeDias } from '@/modules/analytics/consultas';
import { gerarSegredoWebhook, iniciarDiagnostico } from '@/modules/analytics/acoes';
import { comConta } from '@/shared/db';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';
import { FormularioRastreamento } from './FormularioRastreamento';

export const metadata: Metadata = { title: 'Instalação' };

function Codigo({ children }: { children: string }) {
  return (
    <pre className="mono" style={{ background: 'var(--elev)', border: '1px solid var(--bd)', borderRadius: 'var(--raio-m)', padding: 'var(--esp-3)', fontSize: 'var(--tipo-legenda)', overflowX: 'auto', whiteSpace: 'pre', lineHeight: 1.5 }}>
      {children}
    </pre>
  );
}

export default async function PaginaInstalacao({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const [r, diag, resumo] = [await rastreamentoDoSite(u.accountId, site.id), await diagnosticoAtual(u.accountId, site.id), await resumoDeEventos(u.accountId, site.id, periodoDeDias(30))];
  const eventosTeste = diag ? await eventosDeTeste(u.accountId, site.id, diag.token) : [];
  const segredoUmaVez = await comConta(u.accountId, (db) => db.one<{ s: string }>(`select evidence->>'webhook_secret_once' as s from diagnostic_sessions where site_id = $1 and token like 'show-%' and expires_at > now() order by created_at desc limit 1`, [site.id]));
  const snippet = `<script src="${base}/c.v1.js" data-site="${site.publicId}"${r.consentMode === 'exigido' ? ' data-consent="exigido"' : ''} defer></script>`;
  const estados = [
    { nome: 'Script medindo', ok: resumo.ultimoEvento !== null, texto: resumo.ultimoEvento ? `último evento real ${haQuantoTempo(resumo.ultimoEvento)}` : 'nenhum evento real recebido ainda' },
    { nome: 'Formulário recebido', ok: resumo.contatos > 0, texto: resumo.contatos > 0 ? `${resumo.contatos} contatos em 30 dias` : r.formMode === 'desligado' ? 'recebimento desligado' : 'nenhum contato real ainda' },
    { nome: 'Teste de instalação', ok: !!diag && Object.keys(diag.evidence).some((k) => ['page_view', 'click', 'form'].includes(k)), texto: diag ? `token ativo até ${dataHora(diag.expiresAt, site.timezone)} · evidências: ${Object.keys(diag.evidence).filter((k) => k !== 'webhook_secret_once').join(', ') || 'nenhuma'}` : 'nenhum teste em andamento' },
  ];

  return (
    <div className="pagina">
      <Painel kicker="estado por recurso" titulo="O que já está funcionando" subtitulo="Cada item separado. HTTP e PageSpeed não dependem desta instalação.">
        <dl className="definicoes">
          {estados.map((e) => (
            <div key={e.nome} style={{ display: 'contents' }}>
              <dt>{e.nome}</dt>
              <dd><SeloEstado texto={e.ok ? 'Confirmado' : 'Aguardando'} tom={e.ok ? 'ok' : 'warn'} /> <span style={{ color: 'var(--tx2)', fontSize: 'var(--tipo-apoio)' }}>{e.texto}</span></dd>
            </div>
          ))}
        </dl>
      </Painel>

      <Painel kicker="passo 1" titulo="Configuração da coleta">
        <FormularioRastreamento siteId={site.id} r={r} />
      </Painel>

      <Painel kicker="passo 2" titulo="Instalar o coletor" subtitulo="Um script, versionado (v1), servido por este domínio. Não lê campos de formulário. Identificador público: não é credencial.">
        <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-forte)', marginBottom: 'var(--esp-2)' }}>HTML, Framer, Webflow, Wix</h3>
        <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginBottom: 'var(--esp-2)' }}>Cole antes de <code className="mono">&lt;/body&gt;</code> (ou no campo de scripts do construtor):</p>
        <Codigo>{snippet}</Codigo>
        <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-forte)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>React / Next.js</h3>
        <Codigo>{`// app/layout.tsx (Next) ou index.html (Vite/CRA)\n<Script src="${base}/c.v1.js" data-site="${site.publicId}" strategy="afterInteractive" />\n// Rotas SPA são detectadas automaticamente (pushState/popstate).`}</Codigo>
        <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-forte)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>WordPress</h3>
        <Codigo>{`// functions.php do tema filho, ou um plugin de "cabeçalho e rodapé":\nadd_action('wp_footer', function () {\n  echo '${snippet.replace(/'/g, "\\'")}';\n});`}</Codigo>
        <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-forte)', margin: 'var(--esp-4) 0 var(--esp-2)' }}>Marcar botões (contrato estável)</h3>
        <Codigo>{`<a href="https://wa.me/55…" data-track-id="whatsapp-topo" data-track-pos="hero">Falar no WhatsApp</a>\n<button data-track-id="orcamento" data-track-kind="form" data-track-pos="rodape">Pedir orçamento</button>\n<!-- Links wa.me, tel: e mailto: sem data-track-id são identificados automaticamente e marcados como tal. -->`}</Codigo>
        {r.consentMode === 'exigido' && <Codigo>{`// Quando o visitante aceitar analytics:\nwindow.jw('consent');`}</Codigo>}
      </Painel>

      <Painel kicker="passo 3" titulo="Formulários" subtitulo={`Modo atual: ${r.formMode}. ${r.formMode === 'desligado' ? 'Nada é recebido.' : 'A origem da evidência aparece em cada contato.'}`}>
        {r.formMode === 'endpoint' && (
          <>
            <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginBottom: 'var(--esp-2)' }}>O site envia o formulário direto para a central. Sucesso só depois de persistido; reenvio com o mesmo <code className="mono">submission_id</code> não duplica.</p>
            <Codigo>{`<form method="post" action="${base}/api/forms/${site.publicId}" data-track-form="contato">\n  <input type="hidden" name="submission_id" value="GERE-UM-ID-UNICO-POR-ENVIO">\n  <input type="hidden" name="page_path" value="/contato">\n  <input type="hidden" name="session_key" value="">  <!-- o coletor preenche no envio (atribuição); submission_id vazio também é preenchido -->\n  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">  <!-- honeypot -->\n  <input name="name"> <input name="email" type="email"> <input name="phone">\n  <button>Enviar</button>\n</form>\n\n// Ou via fetch (JSON): { submission_id, fields: { name, email, phone }, page_path, session_key }\n// Resposta: { ok: true, status: "recebido", duplicated: false, attribution: "ultimo_clique" | "sem_atribuicao" }`}</Codigo>
          </>
        )}
        {r.formMode === 'webhook' && (
          <>
            <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginBottom: 'var(--esp-2)' }}>O sistema que recebe o formulário (CRM, automação) confirma para a central, servidor a servidor, com assinatura HMAC. Só assim um contato fica “destino confirmado”.</p>
            <form action={gerarSegredoWebhook} style={{ marginBottom: 'var(--esp-3)' }}>
              <input type="hidden" name="site" value={site.id} />
              <button type="submit" className="botao botao-pequeno">{r.temWebhook ? 'Trocar segredo do webhook' : 'Gerar segredo do webhook'}</button>
            </form>
            {segredoUmaVez && <Aviso tom="warn"><span>Segredo (mostrado uma única vez, por 10 minutos): <code className="mono">{segredoUmaVez.s}</code></span></Aviso>}
            <Codigo>{`POST ${base}/api/forms/${site.publicId}/confirmar\nAuthorization: Bearer <segredo>\nX-Johny-Timestamp: <epoch em segundos>\nX-Johny-Nonce: <string única por envio>\nX-Johny-Signature: HMAC_SHA256(segredo, timestamp + "." + nonce + "." + corpo)\nContent-Type: application/json\n\n{ "submission_id": "…", "fields": { "name": "…", "email": "…", "phone": "…" }, "page_path": "/contato", "session_key": "…" }\n// Janela de 5 min; nonce repetido é recusado (replay).`}</Codigo>
          </>
        )}
        {r.formMode === 'auxiliar' && (
          <>
            <Aviso tom="warn"><span>Cópia auxiliar: o site envia uma cópia da tentativa para a central. Isto registra “contato recebido”, mas <strong>nunca</strong> prova que o destino original aceitou o envio. Se o site souber que o destino falhou, informe <code className="mono">destination_status: &quot;failed&quot;</code>.</span></Aviso>
            <Codigo>{`fetch("${base}/api/forms/${site.publicId}?mode=auxiliar", {\n  method: "POST", headers: { "content-type": "application/json" },\n  body: JSON.stringify({ submission_id, fields: { name, email, phone }, page_path: location.pathname, session_key: window.jw('session'), destination_status: "unknown" })\n});`}</Codigo>
          </>
        )}
      </Painel>

      <Painel kicker="passo 4" titulo="Teste de instalação" subtitulo="Um token temporário marca tudo o que ele tocar como diagnóstico: fica fora de contagens, contatos e 'primeiro contato real'." acoes={<form action={iniciarDiagnostico}><input type="hidden" name="site" value={site.id} /><button type="submit" className="botao botao-pequeno">{diag ? 'Novo token' : 'Iniciar teste'}</button></form>}>
        {!diag ? (
          <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>Inicie um teste para receber um link com token. Validade de uma hora.</p>
        ) : (
          <>
            <dl className="definicoes">
              <dt>No seu site</dt>
              <dd>Abra <code className="mono">{site.primaryUrl}?jw_test={diag.token}</code> com o coletor instalado, clique nos botões e envie o formulário.</dd>
              <dt>Página de teste da central</dt>
              <dd><a href={`/teste/${site.publicId}?jw_test=${diag.token}`} target="_blank" rel="noopener noreferrer">{base}/teste/{site.publicId}?jw_test=…</a> — coletor real, botões típicos e formulário, sem depender do seu site.</dd>
              <dt>Evidências recebidas</dt>
              <dd style={{ display: 'flex', gap: 'var(--esp-2)', flexWrap: 'wrap' }}>
                {['page_view', 'click', 'form'].map((k) => <SeloEstado key={k} texto={k === 'page_view' ? 'Visita' : k === 'click' ? 'Clique' : 'Formulário'} tom={diag.evidence[k] ? 'ok' : 'soft'} />)}
              </dd>
            </dl>
            {eventosTeste.length > 0 && (
              <ul style={{ listStyle: 'none', marginTop: 'var(--esp-3)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--tipo-apoio)' }}>
                {eventosTeste.map((e, i) => <li key={i} className="mono" style={{ color: 'var(--tx2)' }}>{dataHora(e.occurredAt, site.timezone)} · {e.type} · {e.path}{e.buttonId ? ` · ${e.buttonId}` : ''}</li>)}
              </ul>
            )}
            <p style={{ marginTop: 'var(--esp-3)', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>Recarregue esta página para ver evidências novas. O navegador do teste guarda o token na sessão: feche a aba ao terminar.</p>
          </>
        )}
      </Painel>
    </div>
  );
}
