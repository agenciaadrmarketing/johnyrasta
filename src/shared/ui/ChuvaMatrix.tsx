'use client';

import { useEffect, useRef } from 'react';

/**
 * Chuva Matrix.
 *
 * Um motor só, duas aparências. Duplicar o desenho em dois componentes faria as
 * duas divergirem na primeira correção aplicada a apenas um deles.
 *
 * Decorativa em qualquer variante: não recebe ponteiro, não entra na árvore de
 * acessibilidade, e **para de desenhar** quando os efeitos estão desligados ou a
 * aba está em segundo plano — nada de queimar CPU e bateria numa aba esquecida.
 *
 * O desligamento respeita `data-fx` no `<html>`, que o script do layout raiz
 * define a partir de `prefers-reduced-motion` e da escolha salva. Quem pede
 * menos movimento não vê animação nenhuma, e há teste de navegador provando.
 */

export type VarianteChuva = 'cabecalho' | 'tela';

/**
 * Cada variante define onde a chuva mora, o tamanho do dígito e a velocidade.
 *
 * `msPorLinha` é o intervalo entre passos: quanto MAIOR, mais devagar a queda.
 *
 * São dois valores, e a diferença não é capricho: na tela do celular a chuva
 * percorre uma altura muito menor, então o mesmo intervalo entrega uma queda
 * que parece lenta demais. No desktop, o contrário — a mesma cadência vira
 * agitação atrás do conteúdo. O ponto de corte acompanha o mesmo 640px que o
 * resto do layout já usa.
 */
const VARIANTES: Record<
  VarianteChuva,
  { tamanho: number; msPorLinha: { celular: number; desktop: number }; estilo: React.CSSProperties }
> = {
  // Cabeçalho inteiro, com o canto esquerdo protegido.
  //
  // A máscara mede em PIXELS, não em porcentagem, e a diferença aparece no
  // celular. O texto que ela protege — o rótulo da seção e o nome da conta —
  // tem largura mais ou menos fixa, de algumas centenas de pixels. Uma máscara
  // em porcentagem protege uma faixa que ENCOLHE junto com a tela: os 18% que
  // deixavam o título limpo num monitor viravam 70px num telefone, e a chuva
  // passava por trás do título e dos botões de período. Era isso que fazia o
  // topo do celular parecer sujo.
  //
  // Com parada em pixel, a área limpa é a mesma em qualquer largura. O efeito
  // colateral é desejado: numa tela estreita sobra pouco espaço à direita, então
  // a chuva fica discreta exatamente onde o cabeçalho concentra os controles.
  cabecalho: {
    tamanho: 20,
    msPorLinha: { celular: 55, desktop: 90 },
    estilo: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0.42,
      maskImage:
        'linear-gradient(90deg, transparent 0px, transparent 260px, rgba(0,0,0,.4) 420px, rgba(0,0,0,.85) 640px, #000 100%)',
      WebkitMaskImage:
        'linear-gradient(90deg, transparent 0px, transparent 260px, rgba(0,0,0,.4) 420px, rgba(0,0,0,.85) 640px, #000 100%)',
    },
  },
  // Tela inteira, atrás do conteúdo.
  tela: {
    tamanho: 28,
    msPorLinha: { celular: 55, desktop: 90 },
    estilo: {
      position: 'fixed',
      inset: 0,
      width: '100%',
      height: '100%',
      zIndex: 0,
      // Sem atenuação no canvas: quem atenua é o véu que a tela de login põe
      // POR CIMA (`.veu-de-fundo`), e não a opacidade daqui. A diferença importa —
      // baixar a opacidade do canvas apaga o dígito inteiro, rastro incluído,
      // e o efeito some; o véu escurece o conjunto mantendo o contraste entre
      // a cabeça brilhante e a cauda.
      opacity: 1,
    },
  },
};

/**
 * Só `0` e `1`, como no Matrix.
 *
 * Antes havia símbolos e letras no conjunto, e o resultado lia como ruído de
 * terminal em vez de binário. É prop para quem quiser outro alfabeto, mas o
 * padrão é este de propósito.
 */
const ALFABETO_PADRAO = '01';

export function ChuvaMatrix({
  variante = 'cabecalho',
  caracteres = ALFABETO_PADRAO,
}: {
  variante?: VarianteChuva;
  caracteres?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { tamanho: TAMANHO, msPorLinha: RITMO, estilo } = VARIANTES[variante];

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const CHARS = (caracteres || ALFABETO_PADRAO).split('');

    // Lido do próprio navegador, e reavaliado quando a largura cruza o corte:
    // girar o celular ou redimensionar a janela troca o ritmo sem recarregar.
    const estreito = window.matchMedia('(max-width: 640px)');
    let MS_POR_LINHA = estreito.matches ? RITMO.celular : RITMO.desktop;
    const aoTrocarLargura = (e: MediaQueryListEvent) => {
      MS_POR_LINHA = e.matches ? RITMO.celular : RITMO.desktop;
    };
    estreito.addEventListener('change', aoTrocarLargura);
    /** Linha atual de cada coluna — INTEIRO, não fração. Veja `passo`. */
    let colunas: number[] = [];
    let largura = 0;
    let altura = 0;
    let raf = 0;
    /** Acumulador de tempo, para a queda não depender da taxa de quadros. */
    let acumulado = 0;
    let ultimo = 0;

    const redimensionar = () => {
      // Sem isto a chuva sai borrada em tela de alta densidade.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      largura = r.width;
      altura = r.height;
      canvas.width = Math.max(1, Math.floor(largura * dpr));
      canvas.height = Math.max(1, Math.floor(altura * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // As colunas são recalculadas: redimensionar com a contagem antiga
      // deixaria faixas vazias ou colunas fora da tela.
      // Começam ACIMA da tela, em alturas sorteadas: a chuva já nasce
      // espalhada, em vez de todas as colunas entrando juntas pelo topo.
      colunas = new Array(Math.ceil(largura / TAMANHO))
        .fill(0)
        .map(() => Math.floor(Math.random() * -100));
      ctx.clearRect(0, 0, largura, altura);
    };

    /*
     * Cada passo desce EXATAMENTE uma linha, e `MS_POR_LINHA` (da variante) diz
     * de quanto em quanto tempo isso acontece.
     *
     * Antes a coluna avançava 0,32 de linha por quadro, e o caractere era
     * desenhado na posição fracionária resultante. O efeito ficava esticado e
     * fora de grade: em vez de uma coluna de texto, saía um borrão vertical com
     * os glifos desalinhados entre si.
     *
     * Descer uma linha inteira por passo é o que faz cada número cair
     * exatamente sob o anterior — que é a aparência da chuva do Matrix. O
     * acumulador desacopla isso da taxa de quadros: numa tela de 120 Hz a
     * queda tem a mesma velocidade que numa de 60.
     *
     * Como o véu que apaga o passado é aplicado uma vez por PASSO (e não por
     * segundo), mudar a velocidade não muda o comprimento do rastro: ele
     * continua com a mesma quantidade de dígitos, caindo mais devagar.
     */

    /**
     * A pilha de fontes do canvas, resolvida em CSS.
     *
     * `ctx.font` NÃO aceita `var(--fonte-mono)`: o canvas usa o parser de fonte
     * do CSS, que não resolve variáveis fora de uma árvore de estilo. Quando a
     * string é inválida, a atribuição é **ignorada em silêncio** e o contexto
     * fica com o padrão `10px sans-serif`. Foi exatamente isso que fez os
     * dígitos continuarem minúsculos por mais que eu aumentasse `tamanho` —
     * o espaçamento das linhas crescia (ele é calculado em JS) e o glifo não.
     *
     * Por isso o valor é lido do elemento e concatenado já resolvido.
     */
    const pilhaDeFontes = (() => {
      const lido = getComputedStyle(document.documentElement)
        .getPropertyValue('--fonte-mono')
        .trim();
      return lido ? `${lido}, ui-monospace, monospace` : 'ui-monospace, monospace';
    })();

    const desenhar = (claro: boolean) => {
      ctx.font = `${TAMANHO}px ${pilhaDeFontes}`;
      // COR ÚNICA para toda a coluna. Uma versão anterior deixava a cabeça mais
      // clara que o rastro; é bonito, mas muda a aparência — a chuva de
      // referência é um campo uniforme de dígitos, onde a profundidade vem só
      // do desbotamento progressivo do véu.
      // No claro, o mesmo verde da marca (`--gold`); no escuro, o verde
      // clássico do filme, que NÃO é token nenhum — é escolha do efeito, e
      // está registrada na skill `design-matrix` para não parecer descuido.
      // `ctx.fillStyle` não resolve `var(--token)`, então o valor é copiado: se
      // `--gold` mudar, `conferir-tokens.mjs` aponta esta linha.
      ctx.fillStyle = claro ? '#1d8840' : '#00FF41';
      const linhas = Math.ceil(altura / TAMANHO);

      for (let i = 0; i < colunas.length; i += 1) {
        const linha = colunas[i]!;
        // Dígito SORTEADO a cada passo, não derivado da posição. Derivar produz
        // padrões diagonais perceptíveis; sortear dá o ruído binário do original.
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)]!, i * TAMANHO, linha * TAMANHO);

        // Reinício probabilístico depois de sair pela base: as colunas voltam
        // em momentos diferentes, então a chuva cai contínua em vez de pulsar
        // em bloco.
        colunas[i] = linha > linhas && Math.random() > 0.975 ? 0 : linha + 1;
      }
    };

    const passo = (agora: number) => {
      raf = requestAnimationFrame(passo);
      const root = document.documentElement;
      if (root.dataset.fx !== 'on' || document.hidden) {
        ultimo = agora;
        return;
      }

      const decorrido = ultimo ? Math.min(agora - ultimo, 250) : 0;
      ultimo = agora;
      acumulado += decorrido;
      if (acumulado < MS_POR_LINHA) return;
      acumulado %= MS_POR_LINHA;

      // O véu de cada passo é o que APAGA o passado: quanto mais fraco, mais
      // longo o rastro. É daqui que vem a cauda desbotada característica. Usa a
      // cor do PRÓPRIO tema — um preto fixo sujaria o tema claro.
      // APAGA o quadro anterior, em vez de pintar por cima dele.
      //
      // Esta é a diferença que fazia a chuva virar uma parede de dígitos. O
      // componente de referência pinta `rgba(0,0,0,0.1)` porque o canvas dele
      // cobre uma página preta: o preto acumulado É o fundo. Aqui o canvas é
      // TRANSPARENTE, sobreposto ao painel — pintar preto não apaga o dígito,
      // acumula uma camada opaca por cima do fundo do site e ainda deixa
      // resíduo verde, porque `source-over` nunca zera o que já está lá.
      //
      // `destination-out` reduz o ALFA do que já foi desenhado. O dígito velho
      // desaparece de verdade, e onde não há chuva o canvas continua
      // transparente, deixando o fundo do painel aparecer.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, largura, altura);
      ctx.globalCompositeOperation = 'source-over';

      const claro = root.dataset.tema === 'claro';

      desenhar(claro);
    };

    redimensionar();
    window.addEventListener('resize', redimensionar);
    raf = requestAnimationFrame(passo);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', redimensionar);
      estreito.removeEventListener('change', aoTrocarLargura);
    };
  }, [TAMANHO, RITMO, caracteres]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-testid={variante === 'tela' ? 'fx-canvas-tela' : 'fx-canvas'}
      style={{ pointerEvents: 'none', ...estilo }}
    />
  );
}
