'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { Icone } from '@/shared/ui/icones';
import type { ItemMenu } from '@/shared/ui/MenuLateral';

/**
 * Navegação de rodapé do celular: no máximo QUATRO destinos e o facho sobre
 * o ativo. O quinto (Relatórios) vive em Configurações, que o menu já leva.
 * Links de verdade, ativo pelo pathname, rótulo visível.
 */
const MAXIMO = 4;

export function MenuInferior({ itens }: { itens: ItemMenu[] }) {
  const pathname = usePathname();
  const visiveis = itens.filter((i) => i.href !== '/relatorios').slice(0, MAXIMO);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const facho = useRef<HTMLSpanElement | null>(null);
  const [pronto, setPronto] = useState(false);

  const indiceAtivo = visiveis.findIndex(
    (i) => pathname === i.href || (i.prefixos ?? []).some((p) => pathname.startsWith(`${p}/`) || pathname === p),
  );

  useLayoutEffect(() => {
    const alvo = refs.current[indiceAtivo];
    const barra = facho.current;
    if (!alvo || !barra) return;
    barra.style.left = `${alvo.offsetLeft + alvo.offsetWidth / 2 - barra.offsetWidth / 2}px`;
    barra.style.opacity = indiceAtivo < 0 ? '0' : '1';
    if (!pronto) {
      const t = requestAnimationFrame(() => setPronto(true));
      return () => cancelAnimationFrame(t);
    }
  }, [indiceAtivo, pronto, visiveis.length]);

  return (
    <nav className="menu-inferior" aria-label="Seções da central">
      {visiveis.map((item, i) => {
        const on = i === indiceAtivo;
        return (
          <Link
            key={item.href}
            href={item.href}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-current={on ? 'page' : undefined}
            className="item-inferior"
          >
            <span className="item-inferior-icone">
              <Icone nome={item.icone} tamanho={22} />
              {item.contagem != null && item.contagem > 0 && (
                <span className="mono item-inferior-contagem" aria-hidden="true">
                  {item.contagem > 99 ? '99+' : item.contagem}
                </span>
              )}
            </span>
            <span className="item-inferior-rotulo">{item.curto ?? item.label}</span>
            {item.contagem != null && item.contagem > 0 && <span className="apenas-leitor">{`, ${item.contagem} itens`}</span>}
          </Link>
        );
      })}
      <span ref={facho} aria-hidden="true" className={pronto ? 'facho facho-animado' : 'facho'} style={{ left: -999, opacity: 0 }}>
        <span className="facho-cone" />
      </span>
    </nav>
  );
}
