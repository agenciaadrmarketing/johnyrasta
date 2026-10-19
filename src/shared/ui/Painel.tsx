import { Sobrelinha } from '@/shared/ui/Sobrelinha';

/** Bloco de conteúdo com título, subtítulo e ações. O `.cartao` da V1, intacto. */
export function Painel({
  titulo,
  subtitulo,
  kicker,
  acoes,
  children,
  id,
}: {
  titulo: string;
  subtitulo?: string;
  kicker?: string;
  acoes?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="cartao" id={id} style={{ padding: '18px 18px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          {kicker && <Sobrelinha tom="discreto">{kicker}</Sobrelinha>}
          <h2 style={{ fontSize: 'var(--tipo-secao)', fontWeight: 'var(--peso-forte)', margin: '2px 0 0' }}>{titulo}</h2>
          {subtitulo && <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginTop: 4 }}>{subtitulo}</p>}
        </div>
        {acoes && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{acoes}</div>}
      </div>
      {children}
    </section>
  );
}

export function Aviso({ children, tom = 'soft' }: { children: React.ReactNode; tom?: 'soft' | 'ok' | 'warn' | 'neg' }) {
  const fundo =
    tom === 'ok' ? 'var(--ok-bg)' : tom === 'warn' ? 'var(--warn-bg)' : tom === 'neg' ? 'var(--neg-bg)' : 'var(--soft-bg)';
  const cor =
    tom === 'ok' ? 'var(--ok-tx)' : tom === 'warn' ? 'var(--warn-tx)' : tom === 'neg' ? 'var(--neg-tx)' : 'var(--soft-tx)';
  return (
    <div
      role={tom === 'neg' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 'var(--raio-m)',
        background: fundo,
        border: `1px solid ${tom === 'ok' ? 'var(--gold-bd)' : 'var(--bd)'}`,
        color: cor,
        fontSize: 'var(--tipo-apoio)',
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
