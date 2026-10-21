import Link from 'next/link';
import { Icone, type IconeNome } from '@/shared/ui/icones';

/**
 * Lista de acontecimentos: ícone, título, detalhe, hora e destino. Adaptada da lista de
 * atividade (bento), em Matrix e só com fatos registrados: incidentes, alertas, medições e
 * contatos. Quem monta a lista decide o que entra; aqui só se desenha.
 */
export type Acontecimento = {
  id: string;
  quando: Date;
  icone: IconeNome;
  tom: 'ok' | 'warn' | 'neg' | 'soft' | 'info';
  titulo: string;
  detalhe: string;
  href: string;
  quandoTexto: string;
};

const COR: Record<Acontecimento['tom'], string> = {
  ok: 'var(--ok-tx)',
  warn: 'var(--warn-tx)',
  neg: 'var(--neg-tx)',
  soft: 'var(--tx3)',
  info: 'var(--gold-tx)',
};

export function LinhaDoTempo({ itens }: { itens: Acontecimento[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }} data-testid="linha-do-tempo">
      {itens.map((a, i) => (
        <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: i === 0 ? 'none' : '1px solid var(--bd)' }}>
          <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, flex: 'none', borderRadius: 'var(--raio-p)', background: 'var(--elev)', border: '1px solid var(--bd)', color: COR[a.tom] }}>
            <Icone nome={a.icone} tamanho={16} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-medio)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.titulo}</span>
            <span style={{ display: 'block', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detalhe}</span>
          </span>
          <span className="mono" style={{ flex: 'none', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', textAlign: 'right' }} title={a.quando.toISOString()}>{a.quandoTexto}</span>
          <Link href={a.href} className="botao botao-pequeno" style={{ flex: 'none' }}>Ver</Link>
        </li>
      ))}
    </ul>
  );
}
