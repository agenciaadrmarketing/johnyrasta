'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Lê uma preferência que vive em `data-*` do `<html>` (tema, fx, menu),
 * aplicada antes da primeira pintura pelo script do layout raiz.
 *
 * `useSyncExternalStore` em vez de `useEffect + setState`: o DOM é a fonte da
 * verdade e o componente se inscreve nele via MutationObserver. No servidor,
 * devolve o padrão — e o atributo real chega sem repintura em cascata.
 */
export function usePreferencia(atributo: 'tema' | 'fx' | 'menu', padrao: string): string {
  const subscribe = useCallback((aoMudar: () => void) => {
    const obs = new MutationObserver(aoMudar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: [`data-${atributo}`] });
    return () => obs.disconnect();
  }, [atributo]);
  const ler = useCallback(() => document.documentElement.dataset[atributo] ?? padrao, [atributo, padrao]);
  return useSyncExternalStore(subscribe, ler, () => padrao);
}

export function gravarPreferencia(atributo: 'tema' | 'fx' | 'menu', valor: string): void {
  document.documentElement.dataset[atributo] = valor;
  try {
    localStorage.setItem(`painel:${atributo}`, valor);
  } catch {
    /* navegação privativa: a preferência vale só nesta aba */
  }
}
