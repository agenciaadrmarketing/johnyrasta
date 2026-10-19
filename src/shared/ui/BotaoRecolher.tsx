'use client';

import { gravarPreferencia, usePreferencia } from '@/shared/ui/usePreferencia';

/** Recolhe e expande a barra lateral por BOTÃO (não por passagem de mouse); a escolha persiste. */
export function BotaoRecolher() {
  const recolhido = usePreferencia('menu', 'aberto') === 'recolhido';
  return (
    <button
      type="button"
      onClick={() => gravarPreferencia('menu', recolhido ? 'aberto' : 'recolhido')}
      aria-pressed={recolhido}
      aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
      className="botao-recolher mono"
    >
      <span aria-hidden="true">{recolhido ? '»' : '«'}</span>
    </button>
  );
}
