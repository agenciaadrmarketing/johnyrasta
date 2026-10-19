import Link from 'next/link';
import { Icone, type IconeNome } from '@/shared/ui/icones';
import { Sobrelinha } from '@/shared/ui/Sobrelinha';

/**
 * Estado vazio, com tom.
 *
 * `neutro` é "não há nada e isso é normal". `aguardando` é "ainda não chegou,
 * e é esperado". `erro` é "deveria estar chegando e parou". `configurar` é
 * "falta uma decisão sua antes de medir".
 *
 * Zero continua não sendo isto: zero é "medimos e não houve", e aparece como
 * número. O vazio é a ausência de base para medir.
 */
export type TomDoVazio = 'neutro' | 'aguardando' | 'erro' | 'configurar';

const BORDA: Record<TomDoVazio, string> = {
  neutro: 'var(--bd)',
  aguardando: 'var(--warn-tx)',
  erro: 'var(--neg)',
  configurar: 'var(--gold-bd)',
};
const TEXTO: Record<TomDoVazio, string> = {
  neutro: 'var(--tx3)',
  aguardando: 'var(--warn-tx)',
  erro: 'var(--neg-tx)',
  configurar: 'var(--gold-tx)',
};

export function EstadoVazio({
  icone = 'caixa',
  titulo,
  explicacao,
  acao,
  tom = 'neutro',
  kicker,
}: {
  icone?: IconeNome;
  titulo: string;
  explicacao?: string;
  acao?: { rotulo: string; href: string };
  tom?: TomDoVazio;
  kicker?: string;
}) {
  return (
    <div
      data-tom={tom}
      data-testid="estado-vazio"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--esp-3)',
        padding: 'var(--esp-7) var(--esp-4)',
        border: `1px dashed ${BORDA[tom]}`,
        borderRadius: 'var(--raio-g)',
      }}
    >
      <span
        aria-hidden="true"
        className={tom === 'neutro' ? undefined : 'mono'}
        style={{
          width: 38,
          height: 38,
          borderRadius: 'var(--raio-p)',
          background: 'var(--soft-bg)',
          border: `1px solid ${tom === 'neutro' ? 'var(--bd)' : BORDA[tom]}`,
          color: TEXTO[tom],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--tipo-corpo)',
          fontWeight: 'var(--peso-forte)',
        }}
      >
        {tom === 'neutro' ? <Icone nome={icone} tamanho={18} /> : '>_'}
      </span>

      <div style={{ maxWidth: 420 }}>
        {kicker && (
          <div style={{ marginBottom: 'var(--esp-1)', color: TEXTO[tom] }}>
            <Sobrelinha tom="discreto">
              <span style={{ color: 'inherit' }}>{kicker}</span>
            </Sobrelinha>
          </div>
        )}
        <p style={{ fontSize: 'var(--tipo-corpo)', color: 'var(--tx)', fontWeight: 'var(--peso-medio)' }}>{titulo}</p>
        {explicacao && (
          <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx3)', marginTop: 'var(--esp-1)', lineHeight: 1.6 }}>
            {explicacao}
          </p>
        )}
      </div>

      {acao && (
        <Link href={acao.href} className="botao">
          {acao.rotulo}
        </Link>
      )}
    </div>
  );
}
