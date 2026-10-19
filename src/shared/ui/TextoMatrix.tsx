'use client';

import { useEffect, useState } from 'react';

/**
 * Texto que "decodifica": cada letra vira um dígito binário por um instante e
 * volta ao caractere real, da esquerda para a direita.
 *
 * Adaptado de um componente pronto (shadcn + Tailwind + `motion`). A ideia é a
 * mesma; a implementação é deste projeto, por três motivos concretos:
 *
 * 1. `motion` custaria uma dependência de animação para mudar a cor de um
 *    `<span>` — que é `transition` de CSS.
 * 2. O original **troca o texto do elemento**. Num link de navegação isso muda
 *    o nome acessível: quem usa leitor de tela ouviria "1 0 1 1 0" no lugar de
 *    "Clientes". Aqui a camada animada é `aria-hidden` e o texto real continua
 *    no DOM, intacto.
 * 3. O original anima uma vez, ao montar. Num menu com seis itens, animar tudo
 *    a cada carregamento seria movimento sem propósito. Aqui quem dispara é o
 *    ponteiro, o teclado ou a própria navegação.
 *
 * Respeita `data-fx`: com os efeitos desligados, nada acontece — nem sequer um
 * temporizador é criado. E para quando a aba vai para segundo plano.
 */

/** Quanto tempo cada letra fica embaralhada. */
const MS_POR_LETRA = 300;
/** Atraso entre o início de uma letra e o da seguinte — é o que cria a cascata. */
const MS_ENTRE_LETRAS = 38;
/** De quanto em quanto tempo o dígito sorteado troca, enquanto embaralhado. */
const MS_POR_SORTEIO = 70;

/**
 * Dígito derivado de `(posição, semente)`, e não de `Math.random()` na
 * renderização. Render precisa ser determinístico: sortear ali faria o mesmo
 * estado produzir saídas diferentes a cada repintura, e o React avisa sobre
 * isso com razão.
 */
function digito(indice: number, semente: number): string {
  const h = Math.imul(indice + 1, 0x9e3779b1) ^ Math.imul(semente + 1, 0x85ebca6b);
  return (h >>> 7) & 1 ? '1' : '0';
}

export function TextoMatrix({ texto, disparo = 0 }: { texto: string; disparo?: number }) {
  /**
   * O tempo decorrido da animação, em passos de `MS_POR_SORTEIO`. `null` = parada.
   *
   * Guardar UM número em vez de um array de booleanos por letra é o que fez
   * esta versão parar de renderizar a cada quadro: a máscara e os dígitos são
   * derivados dele. A versão anterior mantinha um `setInterval` mais dois
   * `setTimeout` por letra — treze letras viravam vinte e sete temporizadores
   * para uma animação de um segundo.
   */
  const [passo, setPasso] = useState<number | null>(null);

  useEffect(() => {
    // `disparo` começa em 0 e só muda quando alguém pede. Sem isto, o efeito
    // rodaria na montagem — que é justamente o que não se quer aqui.
    if (disparo === 0) return;
    if (document.documentElement.dataset.fx !== 'on') return;

    const total = (texto.length - 1) * MS_ENTRE_LETRAS + MS_POR_LETRA;
    let raf = 0;
    let inicio = 0;
    let ultimoPasso = -1;

    const quadro = (agora: number) => {
      if (!inicio) inicio = agora;
      const decorrido = agora - inicio;

      if (decorrido >= total) {
        setPasso(null);
        return;
      }

      // Repinta só quando o dígito sorteado muda de verdade. A 60 Hz isso
      // significa ~14 renderizações por animação, em vez de ~60.
      const atual = Math.floor(decorrido / MS_POR_SORTEIO);
      if (atual !== ultimoPasso) {
        ultimoPasso = atual;
        setPasso(atual);
      }
      raf = requestAnimationFrame(quadro);
    };

    raf = requestAnimationFrame(quadro);

    // Aba em segundo plano já congela o `requestAnimationFrame` sozinha; o que
    // falta é não deixar a animação pendurada ao voltar.
    const aoEsconder = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        setPasso(null);
      }
    };
    document.addEventListener('visibilitychange', aoEsconder);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', aoEsconder);
      // Volta ao texto real. Interromper no meio — trocar de página, por
      // exemplo — deixa o rótulo, nunca meio rótulo.
      setPasso(null);
    };
  }, [disparo, texto]);

  const letras = [...texto];

  /** Uma letra está embaralhada enquanto sua janela de tempo está aberta. */
  const embaralhada = (i: number): boolean => {
    if (passo === null) return false;
    const decorrido = passo * MS_POR_SORTEIO;
    const comeco = i * MS_ENTRE_LETRAS;
    return decorrido >= comeco && decorrido < comeco + MS_POR_LETRA;
  };

  const animando = passo !== null;

  return (
    // `inline-grid` com as duas camadas na MESMA célula: a largura é sempre a do
    // texto real, então o menu não estremece quando "Configurações" vira
    // "10110101010110". Layout que pula durante a animação é pior que não ter
    // animação nenhuma.
    <span style={{ display: 'inline-grid', whiteSpace: 'nowrap' }}>
      <span
        style={{
          gridArea: '1 / 1',
          // `opacity` e não `visibility`/`display`: os dois últimos tirariam o
          // texto da árvore de acessibilidade, e é ele que dá nome ao link.
          opacity: animando ? 0 : 1,
        }}
      >
        {texto}
      </span>

      {animando && (
        <span
          aria-hidden="true"
          style={{ gridArea: '1 / 1', color: 'var(--gold-tx)', textShadow: 'var(--glow)' }}
        >
          {letras.map((c, i) => {
            if (c === ' ') return <span key={i}>&nbsp;</span>;
            const troca = embaralhada(i);
            return (
              // Cada letra vira uma célula com a LETRA REAL invisível dentro,
              // definindo a largura. Sem isso o dígito usava `1ch` da
              // monoespaçada e o rótulo meio decodificado saía desalinhado do
              // próprio texto — era isso que fazia o efeito parecer quebrado.
              <span key={i} style={{ display: 'inline-grid' }}>
                <span style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{c}</span>
                <span
                  className={troca ? 'mono' : undefined}
                  style={{ gridArea: '1 / 1', justifySelf: 'center' }}
                >
                  {troca ? digito(i, passo!) : c}
                </span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
