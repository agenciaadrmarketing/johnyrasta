/**
 * Selo de estado.
 *
 * Texto SEMPRE: a cor reforça, nunca substitui. É o que o brief exige ("estado
 * HTTP com texto e indicação visual, nunca apenas cor") e o que leitor de tela
 * e impressão em preto e branco precisam.
 */
export type TomDeEstado = 'ok' | 'warn' | 'neg' | 'soft';

export function SeloEstado({ texto, tom, titulo }: { texto: string; tom: TomDeEstado; titulo?: string }) {
  return (
    <span className="selo-estado" data-tom={tom} title={titulo}>
      <i aria-hidden="true" />
      {texto}
    </span>
  );
}
