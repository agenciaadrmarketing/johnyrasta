import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { comIngestao } from '@/shared/db';
import { Marca } from '@/shared/ui/Marca';

export const metadata: Metadata = { title: 'Página de teste do coletor', robots: { index: false } };

/**
 * Página PÚBLICA de teste de instalação. Carrega o coletor real deste domínio,
 * tem botões típicos e um formulário que posta no endpoint. Com `?jw_test=<token>`
 * tudo o que acontece aqui é marcado como diagnóstico — fora dos KPIs.
 */
export default async function PaginaTeste({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ jw_test?: string }> }) {
  const { publicId } = await params;
  const { jw_test } = await searchParams;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(publicId)) notFound();
  const site = await comIngestao((db) => db.one<{ name: string }>('select s.name from sites s where s.public_id = $1 and s.archived_at is null', [publicId])).catch(() => null);
  if (!site) notFound();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <main style={{ minHeight: '100vh', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--esp-5)', background: 'var(--header-bg)' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <Marca />
      </div>
      <section className="cartao" style={{ width: '100%', maxWidth: 520, padding: 'var(--esp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--esp-4)' }}>
        <h1 style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-forte)' }}>Teste de instalação · {site.name}</h1>
        <p style={{ color: 'var(--tx2)', fontSize: 'var(--tipo-apoio)' }}>
          {jw_test ? 'Modo diagnóstico ativo: nada daqui entra nas contagens.' : 'Sem token de diagnóstico: os eventos desta página contariam como reais. Abra pelo link da aba Instalação.'}
        </p>
        <div className="amostra">
          <a href="https://wa.me/5511999999999" target="_blank" rel="noopener noreferrer" className="botao botao-primario" data-track-id="whatsapp-teste" data-track-pos="topo">Falar no WhatsApp</a>
          <a href="tel:+5511999999999" className="botao">Ligar</a>
          <a href="mailto:contato@exemplo.com" className="botao">E-mail</a>
          <button type="button" className="botao" data-track-id="botao-generico" data-track-kind="outro">Botão genérico</button>
        </div>
        <form method="post" action={`/api/forms/${publicId}`} className="formulario" data-track-form="formulario-teste" id="form-teste">
          <input type="hidden" name="submission_id" value="" />
          <input type="hidden" name="page_path" value={`/teste/${publicId}`} />
          <input type="hidden" name="session_key" value="" />
          <input type="hidden" name="test_token" value={jw_test ?? ''} />
          <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
          <label className="campo">Nome<input name="name" defaultValue="Teste de instalação" /></label>
          <label className="campo">E-mail<input name="email" type="email" defaultValue="teste@exemplo.com" /></label>
          <label className="campo">Telefone<input name="phone" defaultValue="11 99999-0000" /></label>
          <button type="submit" className="botao botao-primario">Enviar formulário de teste</button>
        </form>
      </section>
      {/* O coletor preenche submission_id e session_key vazios ao enviar um formulário com data-track-form. */}
      <script src="/c.v1.js" data-site={publicId} nonce={nonce} defer />
    </main>
  );
}
