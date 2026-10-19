/**
 * Marca da central.
 *
 * O glifo `>_` vem da V1: nenhum arquivo de logo foi fornecido, e a identidade
 * Matrix é esse prompt em monoespaçada dentro de um quadrado com borda verde.
 * Isolado aqui de propósito — trocar por uma imagem é mexer só neste arquivo.
 */
export function Marca({ compacto = false }: { compacto?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--raio-m)',
        border: '1px solid var(--bd)',
        padding: compacto ? '12px 8px' : '14px 14px',
        background: 'var(--brand-bg)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        className="mono"
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 28,
          height: 28,
          border: '1px solid var(--gold)',
          borderRadius: 'var(--raio-p)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--tipo-corpo)',
          color: 'var(--gold-tx)',
          textShadow: 'var(--glow)',
        }}
      >
        &gt;_
      </span>
      {!compacto && (
        <div className="marca-texto" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--tipo-secao)', fontWeight: 'var(--peso-forte)', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            JohnyWeb
          </div>
          <div style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)' }}>Central de sites</div>
        </div>
      )}
    </div>
  );
}
