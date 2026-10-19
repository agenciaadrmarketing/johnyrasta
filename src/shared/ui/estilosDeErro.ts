/**
 * Estilo dos botões das telas de erro. Módulo neutro (sem `'use client'`):
 * `not-found.tsx` é server component e precisa chamar isto de lá.
 */
export const estiloAcao = (primaria: boolean) =>
  ({
    cursor: 'pointer',
    background: primaria ? 'var(--gold)' : 'var(--elev)',
    color: primaria ? 'var(--on-gold)' : 'var(--tx2)',
    border: primaria ? 'none' : '1px solid var(--bd)',
    borderRadius: 'var(--raio-m)',
    padding: '11px 16px',
    fontWeight: primaria ? 'var(--peso-forte)' : 'var(--peso-medio)',
    fontSize: 'var(--tipo-corpo)',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  }) as const;
