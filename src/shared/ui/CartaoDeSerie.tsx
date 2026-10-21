import Link from 'next/link';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Sobrelinha } from '@/shared/ui/Sobrelinha';

/**
 * Cartão de série temporal, em Matrix: valor em destaque, variação no período, linha(s) em
 * SVG com os tokens do tema, máximo/mínimo/média e seletor de período por link (sem estado
 * no cliente). Renderiza no servidor; o ponto mais recente ganha um marcador e cada ponto
 * tem `<title>` para leitura ao tocar/passar o mouse.
 *
 * Só desenha o que foi medido: lacuna curta (até 2 posições) é atravessada pela linha; lacuna
 * maior a quebra. Pontos só onde houve medição. Sem ao
 * menos dois pontos na série principal, mostra o estado vazio informado — nunca um gráfico
 * plano inventado.
 */
export type PontoDeSerie = { quando: Date; valor: number | null };
export type Serie = { nome: string; cor: 'c1' | 'c2' | 'c3' | 'c4'; pontos: PontoDeSerie[] };

const W = 640;
const H = 150;
const MARGEM = { topo: 10, base: 22, esq: 6, dir: 6 };

/**
 * Liga pontos medidos consecutivos. Uma lacuna de até `maxLacuna` posições (a cadência
 * esperada é diária; uma falha isolada não deve partir a linha) é atravessada; maior que
 * isso, a linha quebra e os pontos ficam soltos: ausência de medição não vira reta.
 */
function caminho(pontos: { x: number; y: number | null }[], maxLacuna = 2): string {
  let d = '';
  let anterior = -1;
  pontos.forEach((p, i) => {
    if (p.y === null) return;
    const liga = anterior >= 0 && i - anterior <= maxLacuna;
    d += `${liga ? ' L' : ' M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    anterior = i;
  });
  return d.trim();
}

export function CartaoDeSerie({
  kicker,
  titulo,
  subtitulo,
  series,
  unidade = '',
  formatar = (v) => String(Math.round(v)),
  formatarData,
  menorEhMelhor = false,
  periodos,
  vazio,
  dominio,
  rodape,
}: {
  kicker?: string;
  titulo: string;
  subtitulo?: string;
  series: Serie[];
  unidade?: string;
  formatar?: (v: number) => string;
  formatarData: (d: Date) => string;
  /** Tempo de resposta: queda é boa. Nota: subida é boa. Decide a cor da variação. */
  menorEhMelhor?: boolean;
  /** Seletor de período por link; o ativo vem de `atual`. */
  periodos?: { rotulo: string; href: string; atual: boolean }[];
  /** Estado vazio quando não há dois pontos medidos. */
  vazio: { titulo: string; explicacao: string; tom?: 'neutro' | 'aguardando' | 'configurar' };
  /** Fixa o eixo (ex.: nota 0–100). Sem isso, ajusta aos dados com folga. */
  dominio?: [number, number];
  rodape?: React.ReactNode;
}) {
  const principal = series[0];
  const medidos = principal?.pontos.filter((p) => p.valor !== null) ?? [];
  const todos = series.flatMap((s) => s.pontos.filter((p) => p.valor !== null).map((p) => p.valor as number));
  const seletor = periodos && (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {periodos.map((p) => (
        <Link key={p.rotulo} href={p.href} className="filtro" aria-current={p.atual ? 'true' : undefined} scroll={false}>
          {p.rotulo}
        </Link>
      ))}
    </div>
  );

  if (medidos.length < 2) {
    return (
      <section className="cartao" style={{ padding: '18px 18px 20px' }}>
        <Cabeca kicker={kicker} titulo={titulo} subtitulo={subtitulo} acoes={seletor} />
        <EstadoVazio titulo={vazio.titulo} explicacao={vazio.explicacao} tom={vazio.tom ?? 'aguardando'} icone="tendencia" />
      </section>
    );
  }

  const primeiro = medidos[0]!.valor as number;
  const ultimo = medidos[medidos.length - 1]!.valor as number;
  const variacao = ultimo - primeiro;
  const melhorou = menorEhMelhor ? variacao < 0 : variacao > 0;
  const estavel = Math.abs(variacao) < 1e-9;
  const corVariacao = estavel ? 'var(--tx2)' : melhorou ? 'var(--ok-tx)' : 'var(--neg-tx)';
  const maximo = Math.max(...medidos.map((p) => p.valor as number));
  const minimo = Math.min(...medidos.map((p) => p.valor as number));
  const media = medidos.reduce((s, p) => s + (p.valor as number), 0) / medidos.length;

  const [lo, hi] = dominio ?? (() => {
    const mn = Math.min(...todos), mx = Math.max(...todos);
    const folga = (mx - mn || Math.abs(mx) || 1) * 0.12;
    return [Math.max(menorEhMelhor ? 0 : -Infinity, mn - folga), mx + folga] as [number, number];
  })();
  const n = principal!.pontos.length;
  const x = (i: number) => MARGEM.esq + (n === 1 ? 0 : (i / (n - 1)) * (W - MARGEM.esq - MARGEM.dir));
  const y = (v: number) => MARGEM.topo + (1 - (v - lo) / (hi - lo || 1)) * (H - MARGEM.topo - MARGEM.base);
  const descricao = `${titulo}: ${formatar(ultimo)}${unidade} em ${formatarData(medidos[medidos.length - 1]!.quando)}; ${formatar(primeiro)}${unidade} em ${formatarData(medidos[0]!.quando)}. Máximo ${formatar(maximo)}, mínimo ${formatar(minimo)}, média ${formatar(media)}.`;
  const rotulosEixo = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => ({ i, texto: formatarData(principal!.pontos[i]!.quando) }));

  return (
    <section className="cartao" style={{ padding: '18px 18px 20px' }}>
      <Cabeca kicker={kicker} titulo={titulo} subtitulo={subtitulo} acoes={seletor} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px' }}>
        <span className="mono" style={{ fontSize: 'var(--tipo-display)', fontWeight: 'var(--peso-forte)', lineHeight: 1, letterSpacing: 'var(--trilha-justa)', fontVariantNumeric: 'tabular-nums' }}>
          {formatar(ultimo)}
          {unidade && <span style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginLeft: 4 }}>{unidade}</span>}
        </span>
        <span className="mono" style={{ fontSize: 'var(--tipo-apoio)', color: corVariacao, fontVariantNumeric: 'tabular-nums' }} title="Diferença entre o último e o primeiro ponto do período">
          {estavel ? '= estável' : `${variacao > 0 ? '▲ +' : '▼ −'}${formatar(Math.abs(variacao))}${unidade}`}
          <span style={{ color: 'var(--tx3)' }}> no período</span>
        </span>
        {series.length > 1 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)' }}>
            {series.map((s) => (
              <span key={s.nome}><span style={{ color: `var(--${s.cor})` }}>■</span> {s.nome}</span>
            ))}
          </span>
        )}
      </div>

      <figure style={{ margin: '12px 0 0' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label={descricao} className="grafico-area">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={MARGEM.esq} x2={W - MARGEM.dir} y1={MARGEM.topo + f * (H - MARGEM.topo - MARGEM.base)} y2={MARGEM.topo + f * (H - MARGEM.topo - MARGEM.base)} stroke="var(--bd)" strokeDasharray="2 6" />
          ))}
          {series.map((s, si) => {
            const pts = s.pontos.map((p, i) => ({ x: x(i), y: p.valor === null ? null : y(p.valor) }));
            const ultimoIdx = (() => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i]!.y !== null) return i; return -1; })();
            return (
              <g key={s.nome}>
                <path d={caminho(pts)} fill="none" stroke={`var(--${s.cor})`} strokeWidth={si === 0 ? 2.5 : 1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={si === 0 ? undefined : '5 5'} vectorEffect="non-scaling-stroke" />
                {pts.map((p, i) => p.y === null ? null : (
                  <circle key={i} cx={p.x} cy={p.y} r={i === ultimoIdx ? 4.5 : 3} fill={i === ultimoIdx ? `var(--${s.cor})` : 'var(--bg)'} stroke={`var(--${s.cor})`} strokeWidth={1.5}>
                    <title>{`${s.nome} · ${formatarData(s.pontos[i]!.quando)}: ${formatar(s.pontos[i]!.valor as number)}${unidade}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          {rotulosEixo.map((r) => (
            <text key={r.i} x={x(r.i)} y={H - 6} textAnchor={r.i === 0 ? 'start' : r.i === n - 1 ? 'end' : 'middle'} fontSize="10" fill="var(--tx3)" fontFamily="var(--fonte-mono)">{r.texto}</text>
          ))}
        </svg>
      </figure>

      <dl className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '10px 0 0', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)', fontVariantNumeric: 'tabular-nums' }}>
        {[['máximo', maximo], ['mínimo', minimo], ['média', media]].map(([k, v]) => (
          <div key={k as string} style={{ display: 'flex', gap: 6 }}>
            <dt>{k}</dt>
            <dd style={{ margin: 0, color: 'var(--tx)' }}>{formatar(v as number)}{unidade}</dd>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <dt>pontos</dt>
          <dd style={{ margin: 0, color: 'var(--tx)' }}>{medidos.length}</dd>
        </div>
      </dl>
      {rodape && <p style={{ marginTop: 10, fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>{rodape}</p>}
    </section>
  );
}

function Cabeca({ kicker, titulo, subtitulo, acoes }: { kicker?: string; titulo: string; subtitulo?: string; acoes?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        {kicker && <Sobrelinha tom="discreto">{kicker}</Sobrelinha>}
        <h2 style={{ fontSize: 'var(--tipo-secao)', fontWeight: 'var(--peso-forte)', margin: '2px 0 0' }}>{titulo}</h2>
        {subtitulo && <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)', marginTop: 4 }}>{subtitulo}</p>}
      </div>
      {acoes && <div style={{ marginLeft: 'auto' }}>{acoes}</div>}
    </div>
  );
}
