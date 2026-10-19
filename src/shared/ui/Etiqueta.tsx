export type TomDeEtiqueta = 'soft' | 'ok' | 'warn' | 'neg' | 'c1' | 'c2' | 'c3' | 'c4';

/**
 * Etiqueta curta em pílula. `c1`..`c4` são a paleta de DADOS, para que uma
 * etiqueta e a série de um gráfico falem a mesma língua.
 */
export function Etiqueta({ texto, tom = 'soft' }: { texto: string; tom?: TomDeEtiqueta }) {
  const fundo =
    tom === 'ok' ? 'var(--ok-bg)'
    : tom === 'warn' ? 'var(--warn-bg)'
    : tom === 'neg' ? 'var(--neg-bg)'
    : tom === 'soft' ? 'var(--soft-bg)'
    : `var(--f${tom.slice(1)})`;
  const cor =
    tom === 'ok' ? 'var(--ok-tx)'
    : tom === 'warn' ? 'var(--warn-tx)'
    : tom === 'neg' ? 'var(--neg-tx)'
    : tom === 'soft' ? 'var(--soft-tx)'
    : `var(--${tom})`;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        borderRadius: 'var(--raio-pilula)',
        background: fundo,
        color: cor,
        fontSize: 'var(--tipo-legenda)',
        whiteSpace: 'nowrap',
      }}
    >
      {texto}
    </span>
  );
}
