'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Marca } from '@/shared/ui/Marca';
import { Icone, type IconeNome } from '@/shared/ui/icones';
import { TextoMatrix } from '@/shared/ui/TextoMatrix';
import { BotaoRecolher } from '@/shared/ui/BotaoRecolher';
import { Avatar } from '@/shared/ui/Avatar';
import { MenuInferior } from '@/shared/ui/MenuInferior';

/**
 * Navegação principal da V2: cinco destinos.
 *
 *   Meus sites · Atenção · Clientes · Relatórios · Configurações
 *
 * O item ativo é derivado do pathname real — uma fonte só. No celular, a
 * barra inferior mostra quatro destinos e "Mais" leva ao resto.
 */
export type ItemMenu = {
  href: string;
  label: string;
  curto?: string;
  icone: IconeNome;
  prefixos?: string[];
  contagem?: number | null;
};

const ITENS: ItemMenu[] = [
  { href: '/sites', label: 'Meus sites', curto: 'Sites', icone: 'globo', prefixos: ['/sites'] },
  { href: '/atencao', label: 'Atenção', icone: 'alerta' },
  { href: '/clientes', label: 'Clientes', icone: 'clientes', prefixos: ['/clientes'] },
  { href: '/relatorios', label: 'Relatórios', icone: 'relatorio', prefixos: ['/relatorios'] },
  { href: '/configuracoes', label: 'Configurações', curto: 'Ajustes', icone: 'ajustes', prefixos: ['/configuracoes', '/referencia'] },
];

export function MenuLateral({
  contagens,
  contaNome,
  usuarioNome,
  sair,
}: {
  contagens: { sites: number; clientes: number; atencao: number };
  contaNome: string;
  usuarioNome: string;
  sair: () => Promise<void>;
}) {
  const pathname = usePathname();
  const ativo = (item: ItemMenu) => pathname === item.href || (item.prefixos ?? []).some((p) => pathname.startsWith(`${p}/`) || pathname === p);

  const [disparos, setDisparos] = useState<Record<string, number>>({});
  const decodificar = (href: string) => setDisparos((d) => ({ ...d, [href]: (d[href] ?? 0) + 1 }));

  // O item que acabou de virar o ativo decodifica uma vez: estado derivado
  // durante a renderização (padrão do React), sem efeito nem repintura extra.
  const itemAtivo = ITENS.find((i) => ativo(i))?.href;
  const [ultimoAtivo, setUltimoAtivo] = useState(itemAtivo);
  if (ultimoAtivo !== itemAtivo) {
    setUltimoAtivo(itemAtivo);
    if (itemAtivo) decodificar(itemAtivo);
  }

  const contagemDe = (href: string) =>
    href === '/sites' ? contagens.sites : href === '/clientes' ? contagens.clientes : href === '/atencao' ? contagens.atencao || null : null;

  return (
    <>
      <aside className="lateral">
        <div className="lateral-marca">
          <Marca />
          <BotaoRecolher />
        </div>

        <nav aria-label="Seções da central" className="lateral-nav">
          {ITENS.map((item) => {
            const on = ativo(item);
            const contagem = contagemDe(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? 'page' : undefined}
                data-rotulo={item.label}
                className="item-menu"
                onMouseEnter={() => decodificar(item.href)}
                onFocus={() => decodificar(item.href)}
              >
                <Icone nome={item.icone} />
                <span className="rotulo-menu">
                  <TextoMatrix texto={item.label} disparo={disparos[item.href] ?? 0} />
                </span>
                {contagem !== null && contagem !== undefined && (
                  <span
                    className="mono contagem-menu"
                    style={{ marginLeft: 'auto', fontSize: 'var(--tipo-micro)', letterSpacing: 'var(--trilha-media)', color: on ? 'var(--gold-tx)' : 'var(--tx3)' }}
                  >
                    {contagem}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="lateral-rodape">
          <Avatar nome={usuarioNome} tamanho={30} />
          <div style={{ minWidth: 0 }}>
            <div className="lateral-rodape-texto" style={{ fontSize: 'var(--tipo-apoio)', fontWeight: 'var(--peso-medio)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {contaNome}
            </div>
            <form action={sair}>
              <button type="submit" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--tipo-legenda)', color: 'var(--gold-tx)' }}>
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <MenuInferior itens={ITENS.map((i) => ({ ...i, contagem: contagemDe(i.href) }))} />
    </>
  );
}
