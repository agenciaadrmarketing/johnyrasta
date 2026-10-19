'use client';

import { gravarPreferencia, usePreferencia } from '@/shared/ui/usePreferencia';

/**
 * Liga/desliga os efeitos e alterna o tema. Desligar os efeitos é permanente,
 * não só visual: o canvas realmente para de desenhar.
 */
export function ControlesAparencia() {
  const fx = usePreferencia('fx', 'off') === 'on';
  const tema = usePreferencia('tema', 'escuro') === 'claro' ? 'claro' : 'escuro';

  return (
    <>
      <button
        type="button"
        onClick={() => gravarPreferencia('fx', fx ? 'off' : 'on')}
        aria-pressed={fx}
        title="Ativar ou desativar os efeitos decorativos"
        className="mono"
        style={{
          cursor: 'pointer',
          fontSize: 'var(--tipo-legenda)',
          letterSpacing: 'var(--trilha-media)',
          padding: '8px 11px',
          borderRadius: 'var(--raio-p)',
          background: 'var(--elev)',
          border: '1px solid var(--bd)',
          color: fx ? 'var(--gold-tx)' : 'var(--tx3)',
        }}
      >
        {fx ? '>_ FX ON' : '>_ FX OFF'}
      </button>

      <button
        type="button"
        onClick={() => gravarPreferencia('tema', tema === 'escuro' ? 'claro' : 'escuro')}
        aria-label={tema === 'escuro' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        style={{ display: 'flex', alignItems: 'center', flex: 'none', width: 64, height: 32, padding: 3, borderRadius: 'var(--raio-pilula)', cursor: 'pointer', background: 'var(--elev)', border: '1px solid var(--bd)' }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'var(--gold)',
            color: 'var(--on-gold)',
            transform: tema === 'escuro' ? 'translateX(0)' : 'translateX(32px)',
            transition: 'transform 200ms',
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {tema === 'escuro' ? (
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </>
            )}
          </svg>
        </span>
      </button>
    </>
  );
}
