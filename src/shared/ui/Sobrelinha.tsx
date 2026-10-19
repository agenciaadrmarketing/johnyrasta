/**
 * Sobrelinha — o rótulo caixa-alta que antecede um título.
 *
 * Existia em quatro lugares, copiado à mão, e nenhum deles concordava: o
 * cabeçalho de página usava 11px com trilha `.1em`; o cabeçalho de painel, 10,5px
 * com `.12em`. Mesmo papel, quatro valores. A diferença é pequena demais para
 * alguém apontar e grande o bastante para as telas não parecerem a mesma peça.
 *
 * Aqui o papel tem UM tamanho. O que varia é só o tom, e ele quer dizer algo:
 *
 *  - `marca` — sobrelinha de PÁGINA. Verde da marca, porque anuncia onde você
 *    está no produto.
 *  - `discreto` — sobrelinha de PAINEL, dentro de uma página que já se
 *    identificou. Compete com o título ao lado se gritar.
 *
 * A caixa-alta é aplicada aqui, e não digitada em cada chamada: texto que chega
 * em minúsculas continua funcionando, e quem lê o código vê a palavra como ela é.
 */
export function Sobrelinha({
  children,
  tom = 'marca',
}: {
  children: React.ReactNode;
  tom?: 'marca' | 'discreto';
}) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 'var(--tipo-legenda)',
        // Caixa-alta sem trilha fica apertada: as maiúsculas têm a mesma altura
        // e o olho perde a fronteira entre elas.
        letterSpacing: 'var(--trilha-ampla)',
        textTransform: 'uppercase',
        color: tom === 'marca' ? 'var(--gold-tx)' : 'var(--tx3)',
        /* SEM brilho, e a decisão mudou desde que isto foi escrito.
           A referência usa `drop-shadow-[0_0_2px_…]` — 2px. `--glow` é 18px,
           desenhado para um `h1` de 28px; em texto de 11,5px ele borra a letra
           em vez de acender o rótulo, e sobrelinha fica logo acima de um título
           que JÁ brilha. Dois brilhos empilhados não são hierarquia. */
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
}
