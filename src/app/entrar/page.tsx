import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Marca } from '@/shared/ui/Marca';
import { ChuvaMatrix } from '@/shared/ui/ChuvaMatrix';
import { usuarioDaSessao } from '@/modules/accounts/session';
import { FormularioDeLogin } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  if (await usuarioDaSessao()) redirect('/sites');
  const { destino } = await searchParams;
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--header-bg)' }}>
      <ChuvaMatrix variante="tela" />
      <div className="veu-de-fundo" aria-hidden="true" />
      <div style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        <Marca />
        <FormularioDeLogin destino={destino} />
        <p className="mono" style={{ marginTop: 12, textAlign: 'center', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)' }}>
          JohnyWeb V2 · acesso restrito
        </p>
      </div>
    </main>
  );
}
