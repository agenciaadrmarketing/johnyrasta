'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ABAS = [
  { slug: '', label: 'Resumo' },
  { slug: 'disponibilidade', label: 'Disponibilidade' },
  { slug: 'velocidade', label: 'Velocidade' },
  { slug: 'contatos', label: 'Contatos' },
  { slug: 'botoes', label: 'Botões e horários' },
  { slug: 'instalacao', label: 'Instalação' },
] as const;

/** Abas do espaço do site. A ativa vem do pathname, nunca de estado paralelo. */
export function Abas({ siteId }: { siteId: string }) {
  const pathname = usePathname();
  return (
    <div className="abas">
      <nav aria-label="Seções do site" style={{ display: 'flex', gap: 4, minWidth: 'max-content' }}>
        {ABAS.map((aba) => {
          const href = aba.slug ? `/sites/${siteId}/${aba.slug}` : `/sites/${siteId}`;
          const on = pathname === href;
          return (
            <Link key={aba.slug} href={href} aria-current={on ? 'page' : undefined} className="aba-site">
              {aba.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
