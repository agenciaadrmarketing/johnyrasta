/**
 * Avatar de iniciais.
 *
 * Não há foto de cliente nem de usuário neste produto, e inventar uma (gerada,
 * ou vinda de um serviço externo) trocaria um dado que não temos por um enfeite
 * — além de abrir uma saída de rede que hoje não existe.
 *
 * O que as iniciais fazem é o que o avatar faz numa tabela densa: dão uma
 * âncora visual para o olho percorrer a coluna. É decorativo (`aria-hidden`):
 * o nome está escrito ao lado, e um leitor de tela anunciando "A T" antes de
 * "ADR MARKETING" só atrapalharia.
 *
 * Estava escrito à mão no rodapé do menu. Virou componente porque passou a ter
 * dois usos — e o que não é componente escapa da próxima mudança de estilo.
 */
export function iniciaisDe(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ nome, tamanho = 24 }: { nome: string; tamanho?: number }) {
  return (
    <span
      className="mono"
      aria-hidden="true"
      style={{
        flex: 'none',
        width: tamanho,
        height: tamanho,
        borderRadius: '50%',
        background: 'var(--elev)',
        border: '1px solid var(--bd)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Duas letras num círculo pequeno pedem um corpo menor que o da célula,
        // senão elas encostam na borda.
        fontSize: 'var(--tipo-micro)',
        letterSpacing: 'var(--trilha-media)',
        color: 'var(--tx3)',
        lineHeight: 1,
      }}
    >
      {iniciaisDe(nome) || '·'}
    </span>
  );
}
