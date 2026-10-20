import type { Metadata } from 'next';
import Link from 'next/link';
import { Marca } from '@/shared/ui/Marca';
import { ChuvaMatrix } from '@/shared/ui/ChuvaMatrix';
import { recuperacaoDisponivel } from '@/modules/accounts/recuperacao';
import { FormularioDeRecuperacao } from './formulario';

export const metadata: Metadata = { title: 'Recuperar senha' };
export const dynamic = 'force-dynamic';

export default function PaginaRecuperar() {
  const d = recuperacaoDisponivel();
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--header-bg)' }}>
      <ChuvaMatrix variante="tela" />
      <div className="veu-de-fundo" aria-hidden="true" />
      <div style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        <Marca />
        <div className="cartao-vidro" style={{ marginTop: 18 }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-forte)' }}>Recuperar senha</h1>
            {d.disponivel ? (
              <FormularioDeRecuperacao />
            ) : (
              <p role="status" style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>
                {d.motivo} Peça a quem administra a central para redefinir a senha.
              </p>
            )}
            <Link href="/entrar" style={{ fontSize: 'var(--tipo-apoio)' }}>Voltar para entrar</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
