import type { Metadata } from 'next';
import Link from 'next/link';
import { Marca } from '@/shared/ui/Marca';
import { ChuvaMatrix } from '@/shared/ui/ChuvaMatrix';
import { linkValido } from '@/modules/accounts/recuperacao';
import { FormularioDeRedefinicao } from './formulario';

export const metadata: Metadata = { title: 'Redefinir senha', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function PaginaRedefinir({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const valido = await linkValido(token);
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--header-bg)' }}>
      <ChuvaMatrix variante="tela" />
      <div className="veu-de-fundo" aria-hidden="true" />
      <div style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        <Marca />
        <div className="cartao-vidro" style={{ marginTop: 18 }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-forte)' }}>Nova senha</h1>
            {valido ? (
              <FormularioDeRedefinicao token={token} />
            ) : (
              <p role="alert" style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--neg-tx)' }}>
                Este link é inválido, venceu ou já foi usado. <Link href="/recuperar-senha">Peça um novo</Link>.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
