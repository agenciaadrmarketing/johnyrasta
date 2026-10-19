import { ChuvaMatrix } from '@/shared/ui/ChuvaMatrix';
import { Sobrelinha } from '@/shared/ui/Sobrelinha';
import { ControlesAparencia } from '@/shared/ui/ControlesAparencia';

/**
 * Cabeçalho de página: UMA linha, fixo no topo, translúcido, com a chuva
 * Matrix atrás (controlável pelo botão FX e por `prefers-reduced-motion`).
 *
 * Título em monoespaçada com gradiente recortado, ações à direita. O que não
 * cabe numa linha (kicker, meta) desce para o `sub-cabecalho`.
 */
export function Cabecalho({
  kicker,
  titulo,
  meta,
  acoes,
}: {
  kicker: string;
  titulo: string;
  meta?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  return (
    <>
      <header className="cabecalho" style={{ overflow: 'hidden', borderBottom: '1px solid var(--bd)' }}>
        <ChuvaMatrix variante="cabecalho" />
        <i aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, width: 22, height: 22, borderTop: '1px solid var(--gold)', borderLeft: '1px solid var(--gold)', opacity: 0.55 }} />
        <i aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, width: 22, height: 22, borderTop: '1px solid var(--gold)', borderRight: '1px solid var(--gold)', opacity: 0.55 }} />
        <div className="cabecalho-linha">
          <div className="cabecalho-titulo">
            <h1
              className="mono"
              title={titulo}
              style={{ fontWeight: 'var(--peso-leve)', fontSize: 'var(--tipo-display)', letterSpacing: 'var(--trilha-justa)', lineHeight: 1.1 }}
            >
              {titulo}
            </h1>
          </div>
          <div className="cabecalho-acoes">
            {acoes}
            <ControlesAparencia />
          </div>
        </div>
      </header>
      <div className="sub-cabecalho">
        <Sobrelinha>{kicker}</Sobrelinha>
        {meta && <span>{meta}</span>}
      </div>
    </>
  );
}
