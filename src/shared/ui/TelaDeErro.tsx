'use client';

import type { ReactNode } from 'react';
import { ChuvaMatrix } from '@/shared/ui/ChuvaMatrix';
import { TextoMatrix } from '@/shared/ui/TextoMatrix';

/**
 * A tela que aparece quando algo dá errado — 404, falha de renderização, ou o
 * colapso do próprio layout raiz.
 *
 * Uma só, com a identidade do painel, em vez de três improvisos: a página
 * padrão do Next para 404, a de digest para erro, e nada para o resto. Cada
 * caso muda o CÓDIGO, o texto e as ações; a moldura é sempre a mesma.
 *
 * Adaptado de um componente pronto (shadcn + Tailwind + `motion` + `clsx` +
 * `tailwind-merge`). Nenhuma dessas dependências entrou:
 *
 * - `clsx` e `tailwind-merge` existem para resolver conflito entre classes do
 *   Tailwind. Sem Tailwind, não há conflito a resolver.
 * - `motion` seria uma biblioteca de animação para mudar opacidade e deslocar
 *   dois pseudo-elementos em 3px — que é `transition` de CSS.
 * - O `useReducedMotion` dela é substituído pelo `data-fx` que este projeto já
 *   usa, e que respeita tanto a preferência do sistema quanto o botão FX.
 *
 * O embaralhamento do código reaproveita `TextoMatrix`, o mesmo do menu. Duas
 * implementações do mesmo efeito divergiriam na primeira correção feita só numa
 * delas — e o alfabeto aqui é binário, como no resto do painel, não o
 * `#%&@$?/\` do original.
 */
export function TelaDeErro({
  codigo,
  titulo,
  descricao,
  detalhe,
  acoes,
}: {
  /** O número grande. Curto: ele é lido de longe, não analisado. */
  codigo: string;
  titulo: string;
  descricao: ReactNode;
  /** Identificador da ocorrência, quando existir. Some quando não existe. */
  detalhe?: ReactNode;
  acoes: ReactNode;
}) {
  // Uma passada de decodificação ao abrir. `TextoMatrix` só anima quando o
  // disparo muda, então o estado sai de 0 depois da montagem.
  // `TextoMatrix` só anima quando `disparo` é diferente de 0: começar em 1
  // produz exatamente uma passada ao montar, sem efeito próprio.
  const disparo = 1;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'var(--header-bg)',
      }}
    >
      <ChuvaMatrix variante="tela" />
      <div className="veu-de-fundo" aria-hidden="true" />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 520,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        {/*
          `clamp` em vez de breakpoints: o número acompanha a largura sem
          nenhuma media query, e não estoura a tela do celular.
        */}
        <h1
          className="mono"
          style={{
            fontSize: 'var(--tipo-heroico)',
            lineHeight: 0.9,
            fontWeight: 700,
            letterSpacing: 'var(--trilha-justa)',
            color: 'var(--gold-tx)',
            textShadow: 'var(--glow)',
          }}
        >
          <TextoMatrix texto={codigo} disparo={disparo} />
        </h1>

        <div className="cartao-vidro" style={{ width: '100%', textAlign: 'left' }}>
          <div className="feixes" aria-hidden="true">
            <span className="feixe feixe-h feixe-topo" />
            <span className="feixe feixe-v feixe-direita" />
            <span className="feixe feixe-h feixe-base" />
            <span className="feixe feixe-v feixe-esquerda" />
          </div>

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 'var(--tipo-secao)', fontWeight: 600 }}>{titulo}</h2>
            <div style={{ fontSize: 'var(--tipo-corpo)', color: 'var(--tx2)', lineHeight: 1.6 }}>{descricao}</div>
            {detalhe}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>{acoes}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
