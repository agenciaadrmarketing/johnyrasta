'use client';

/**
 * Imprime pelo navegador. É o único caminho do relatório para PDF: o
 * `@media print` do tema esconde menu e controles e força fundo branco. O
 * botão some na impressão (`nao-imprime`) para não aparecer no papel.
 */
export function BotaoImprimir({ rotulo = 'Imprimir ou salvar em PDF' }: { rotulo?: string }) {
  return (
    <button type="button" className="botao nao-imprime" onClick={() => window.print()}>
      {rotulo}
    </button>
  );
}
