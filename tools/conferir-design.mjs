#!/usr/bin/env node
/**
 * Confere o sistema visual contra `src/styles/theme.css`.
 *
 * Adaptado de uma skill genérica de design system que GERAVA paleta a partir de
 * uma cor de marca. Aqui isso não serve: os tokens deste projeto são os valores
 * exatos do protótipo exportado do Claude Design, preservados de propósito para
 * que a aparência não mudasse ao trocar de tecnologia. Gerar uma paleta nova
 * seria jogar fora a decisão que o arquivo inteiro existe para manter.
 *
 * O que ESTE projeto precisa é do contrário: um guarda que avise quando alguém
 * sair do sistema sem querer. São três perguntas, todas respondidas por leitura
 * de arquivo — nada roda navegador, nada precisa de banco.
 *
 *   1. Os dois temas definem o MESMO conjunto de tokens?
 *      Um token que existe só no escuro não dá erro: no claro ele cai no valor
 *      do `:root`, que é o escuro — e a tela fica com texto quase preto sobre
 *      fundo quase preto, sem nenhum aviso.
 *
 *   2. Algum componente escreve cor crua em vez de `var(--token)`?
 *      Nem toda ocorrência é defeito, e o script distingue: `manifest.ts` e as
 *      meta tags de `theme-color` NÃO PODEM ler CSS, então ali a cor crua é
 *      obrigatória — e é exatamente por isso que ela precisa ser vigiada.
 *
 *   3. Todo par texto-sobre-fundo alcança 4,5:1?
 *      É o mínimo da WCAG para texto de corpo, e este painel é feito de
 *      legenda pequena. Medido antes de existir esta conferência: o tema CLARO
 *      reprovava em sete pares — `--tx3` sobre `--elev` dava 3,78:1, e `--tx3`
 *      é justamente o token de toda legenda da interface.
 *
 *   4. As cores cruas que copiam um token ainda BATEM com ele?
 *      É o defeito silencioso de verdade: mudar `--side` no tema e esquecer o
 *      manifesto deixa a barra do navegador com a cor antiga. Nada quebra,
 *      ninguém vê, e a identidade fica meio velha e meio nova.
 *
 * Uso:  node tools/conferir-design.mjs
 * Sai com código 1 se achar divergência, para poder entrar no CI.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const TEMA = join(RAIZ, 'src/styles/theme.css');

/**
 * As cópias DECLARADAS: qual token cada valor cravado espelha.
 *
 * Existe porque a versão anterior errava o sentido da pergunta. Ela varria as
 * cores cruas e rastreava as que BATIAM com algum token — e ficava muda no
 * instante em que uma deixava de bater, que é exatamente o defeito.
 *
 * Medido: ao mexer na escala de superfície, `--side` foi de #020502 para
 * #060b07, e as duas cópias (manifesto PWA e `theme-color`) sumiram da lista
 * de vigiadas. Cinco viraram três, sem uma linha de aviso. A barra do
 * navegador ficaria com a cor antiga para sempre.
 *
 * Agora a pergunta é a inversa e é uma AFIRMAÇÃO: o valor atual do token
 * PRECISA aparecer neste arquivo. Cor deliberada que não copia token nenhum (o
 * preto da chuva, as cores do console do cliente) simplesmente não é declarada
 * — e por isso não vira ruído.
 */
const COPIAS_DECLARADAS = [
  { arquivo: 'src/app/layout.tsx', token: '--side', tema: 'escuro' },
  { arquivo: 'src/app/layout.tsx', token: '--side', tema: 'claro' },
  { arquivo: 'src/app/manifest.ts', token: '--bg', tema: 'escuro' },
  { arquivo: 'src/app/manifest.ts', token: '--side', tema: 'escuro' },
  { arquivo: 'src/shared/ui/ChuvaMatrix.tsx', token: '--gold', tema: 'claro' },
];

/** Onde a cor crua é OBRIGATÓRIA, com o motivo. Nada aqui é tolerância vaga. */
const FORA_DO_ALCANCE_DO_CSS = {
  'src/app/manifest.ts': 'manifesto PWA: o Chrome lê JSON, não folha de estilo',
  'src/app/layout.tsx': 'meta theme-color: pinta a barra do navegador antes do CSS existir',
  'src/shared/ui/ChuvaMatrix.tsx': 'canvas: `ctx.fillStyle` não resolve `var(--token)`',
};

/**
 * Lê os tokens de um bloco.
 *
 * Divide por DECLARAÇÃO (`;`), não por linha. A versão anterior lia linha a
 * linha, e por isso não enxergava token nenhum cujo valor quebrasse em duas —
 * `--header-bg`, `--brand-bg` e as sombras empilhadas. Eles nunca entraram na
 * conferência de paridade: um deles podia faltar num tema e o script diria que
 * está tudo certo. O sintoma que revelou isso foi o contrário e por sorte —
 * `--sombra-1` acusado como ausente no claro, onde ele existia e só estava
 * escrito em duas linhas.
 *
 * Valor de token aqui nunca contém `;`; se um dia contiver (uma `url()` com
 * ponto e vírgula), esta divisão precisa passar a respeitar parênteses.
 */
function lerTokens(css, seletor) {
  const bloco = css.slice(css.indexOf(seletor));
  // Comentários saem ANTES de qualquer divisão. Os comentários deste arquivo
  // citam tokens ("--tx3 dava 3,78:1 sobre --elev: reprova…"), e um `--nome:`
  // dentro de comentário é indistinguível de uma declaração para quem lê por
  // expressão regular — o token citado entrava no lugar do declarado.
  const corpo = bloco
    .slice(bloco.indexOf('{') + 1, bloco.indexOf('}'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map();
  for (const declaracao of corpo.split(';')) {
    // `[\s\S]` em vez de `.`: o valor pode atravessar linhas.
    const m = declaracao.match(/(--[\w-]+)\s*:\s*([\s\S]+)/);
    if (m) tokens.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

/**
 * Põe uma cor numa forma comparável, ou devolve null se não for cor.
 *
 * `rgba(112, 255, 139, 0.12)` e `rgba(112,255,139,.12)` são a MESMA cor escrita
 * de dois jeitos — e é assim que a cópia escapa de uma comparação por texto.
 * Espaço some, `.12` vira `0.12`, e alfa 1 vira a forma sem alfa.
 */
function normalizarCor(valor) {
  const v = valor.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v;
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!m) return null;
  const p = m[1].split(',').map((x) => x.trim());
  if (p.length < 3) return null;
  const alfa = p[3] === undefined ? 1 : parseFloat(p[3]);
  return `rgba(${p[0]},${p[1]},${p[2]},${alfa})`;
}

function arquivos(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.(ts|tsx)$/.test(caminho)) achados.push(caminho);
  }
  return achados;
}

const css = readFileSync(TEMA, 'utf8');
const escuro = lerTokens(css, "[data-tema='escuro']");
const claro = lerTokens(css, "[data-tema='claro']");

const problemas = [];
const avisos = [];

// ── 1. Paridade entre os temas ───────────────────────────────────────────────
for (const token of escuro.keys()) {
  if (!claro.has(token)) {
    problemas.push(`${token} existe no tema escuro e NÃO no claro — no claro ele herda o valor escuro, em silêncio.`);
  }
}
for (const token of claro.keys()) {
  if (!escuro.has(token)) {
    problemas.push(`${token} existe no tema claro e NÃO no escuro.`);
  }
}

// ── 2 e 3. Cor crua fora do tema ─────────────────────────────────────────────
const porValor = new Map();
for (const [tema, tokens] of [['escuro', escuro], ['claro', claro]]) {
  for (const [token, valor] of tokens) {
    // Hexadecimal E `rgba()`. Antes só o hexadecimal entrava, e foi por essa
    // fresta que passou o defeito real: `CartaoIndicador` trazia
    // `rgba(112,255,139,.10)` escrito à mão — o verde do tema ESCURO — no
    // gradiente do cartão de destaque. Ele não trocava no tema claro, e o
    // cartão puxava para um verde fora da paleta clara. Nada quebrava.
    const bruto = normalizarCor(valor);
    if (bruto) porValor.set(bruto, [...(porValor.get(bruto) ?? []), `${token} (${tema})`]);
  }
}

for (const caminho of arquivos(join(RAIZ, 'src'))) {
  const rel = relative(RAIZ, caminho);
  // Comentário não é interface. Documentar o valor ANTIGO ao corrigir uma cor
  // crua é justamente o que se quer que alguém faça — e sem isto o verificador
  // reprovava a própria explicação do conserto.
  // Trocar por espaços, e não apagar: o número da linha precisa continuar
  // apontando para onde o defeito está.
  const conteudo = readFileSync(caminho, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (c) => ' '.repeat(c.length));
  const linhas = conteudo.split('\n');

  linhas.forEach((linha, i) => {
    const crus = [
      ...(linha.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      // `rgba()` conta como cor crua na mesma medida. Sem isto, escrever o
      // valor de um token em rgba passava direto.
      ...(linha.match(/rgba?\([\d\s.,]+\)/g) ?? []),
    ];
    for (const bruto of crus) {
      const motivo = FORA_DO_ALCANCE_DO_CSS[rel];
      const igualA = porValor.get(normalizarCor(bruto) ?? '');

      if (!motivo) {
        problemas.push(`${rel}:${i + 1} usa a cor crua ${bruto} — a interface lê o tema por var(--token).`);
      } else if (igualA) {
        // Cor crua obrigatória QUE COPIA um token: é a que sai de sincronia.
        avisos.push(`${rel}:${i + 1} repete ${bruto}, que é ${igualA.join(' e ')} — ${motivo}. Mudou o token? Mude aqui também.`);
      }
    }
  });
}

// ── 4. Contraste ─────────────────────────────────────────────────────────────
//
// Os pares que a interface realmente usa. Fundo com alfa é composto sobre
// `--bg` antes de medir: `rgba(…, .12)` sobre preto não é a cor que se vê.
const PARES = [
  // Paleta de dados: número e etiqueta escritos em --c1..--c5 sobre cartão e superfície levantada.
  ['--c1', '--card'], ['--c2', '--card'], ['--c3', '--card'], ['--c4', '--card'], ['--c5', '--card'],
  ['--c1', '--elev'], ['--c2', '--elev'], ['--c3', '--elev'], ['--c4', '--elev'], ['--c5', '--elev'],
  ['--tx', '--tip'], ['--tx3', '--tip'],
  ['--c1', '--f1'], ['--c2', '--f2'], ['--c3', '--f3'], ['--c4', '--f4'],
  ['--tx', '--bg'], ['--tx', '--card'], ['--tx', '--side'], ['--tx', '--elev'], ['--tx', '--hover'],
  ['--tx2', '--bg'], ['--tx2', '--card'], ['--tx2', '--side'], ['--tx2', '--elev'],
  ['--tx3', '--bg'], ['--tx3', '--card'], ['--tx3', '--side'], ['--tx3', '--elev'],
  ['--gold-tx', '--bg'], ['--gold-tx', '--card'], ['--gold-tx', '--elev'],
  ['--pos-tx', '--card'], ['--neg-tx', '--card'],
  ['--ok-tx', '--ok-bg'], ['--warn-tx', '--warn-bg'], ['--soft-tx', '--soft-bg'],
  // O par novo. A família de estado tinha três fundos e quatro textos; o
  // quarto fundo era escrito à mão nos componentes, e por isso nunca passou
  // por esta medição.
  ['--neg-tx', '--neg-bg'],
  ['--on-gold', '--gold'],
];
const MINIMO = 4.5;

function cor(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /rgba?\(([^)]+)\)/i.exec(v);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x.trim())); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return null;
}
const sobre = (f, b) => (f[3] >= 1 ? f : [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1));
const luz = (c) => {
  const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const razao = (f, b) => (Math.max(luz(f), luz(b)) + 0.05) / (Math.min(luz(f), luz(b)) + 0.05);

for (const [tema, tokens] of [['escuro', escuro], ['claro', claro]]) {
  const fundo = cor(tokens.get('--bg'));
  for (const [frente, atras] of PARES) {
    const f = cor(tokens.get(frente));
    const a = cor(tokens.get(atras));
    if (!f || !a) continue;
    const base = sobre(a, fundo);
    const r = razao(sobre(f, base), base);
    if (r < MINIMO) {
      problemas.push(`contraste ${frente} sobre ${atras} no tema ${tema}: ${r.toFixed(2)}:1 — mínimo ${MINIMO}:1 para texto de corpo.`);
    }
  }
}

// ── 5. A escala é um conjunto FECHADO ────────────────────────────────────────
//
// Medido antes desta conferência existir: 19 tamanhos de fonte distintos em 291
// usos — 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 19,
// 26, 28, 32. Quinze deles num intervalo de nove pixels. E `.1em` convivendo com
// `.12em` no MESMO papel, a sobrelinha, em dois componentes.
//
// Ninguém percebe 12 contra 12,5. O que se percebe é o resultado: duas telas que
// dizem a mesma coisa com pesos visuais diferentes, sem que ninguém consiga
// apontar o que está errado.
//
// Escala sem quem a defenda dura até a próxima tela. Por isso isto é conferência
// e não convenção: valor cru reprova, e token fora do conjunto também — um
// `var(--tipo-medio)` inventado não existe no CSS e o navegador o ignora **em
// silêncio**, deixando o tamanho herdado no lugar.
const ESCALA = {
  fontSize: ['micro', 'legenda', 'apoio', 'corpo', 'secao', 'titulo', 'display', 'numero', 'heroico'].map((n) => `--tipo-${n}`),
  letterSpacing: ['ampla', 'media', 'justa', 'fechada'].map((n) => `--trilha-${n}`),
  borderRadius: ['p', 'm', 'g', 'pilula'].map((n) => `--raio-${n}`),
};

for (const arquivo of arquivos(join(RAIZ, 'src'))) {
  if (!arquivo.endsWith('.tsx')) continue;
  const rel = relative(RAIZ, arquivo);
  readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
    for (const [prop, permitidos] of Object.entries(ESCALA)) {
      // Valor cru: número, ou string que não é `var(--token)`.
      const cru = linha.match(new RegExp(`${prop}: (?!'var\\()([0-9][\\w.%]*|'[^']*')`));
      // Duas exceções, e as duas são a MESMA ideia: não é valor de escala, é
      // outra coisa que por acaso mora na mesma propriedade.
      //   · `borderRadius: '50%'` é geometria (círculo).
      //   · `letterSpacing: 'normal'` é RESET — um filho desfazendo a trilha
      //     fechada que herdou do pai. Sem ele, o denominador de "2/4" herdaria
      //     o aperto que foi escolhido para o numerador grande.
      const reset =
        (prop === 'borderRadius' && /^'\d+%'$/.test(cru?.[1] ?? '')) ||
        (prop === 'letterSpacing' && cru?.[1] === "'normal'");
      if (cru && !reset) {
        problemas.push(`${rel}:${i + 1} usa ${prop}: ${cru[1]} — a escala é fechada; use ${permitidos.join(' · ')}.`);
      }
      const token = linha.match(new RegExp(`${prop}: 'var\\((--[\\w-]+)\\)'`));
      if (token && !permitidos.includes(token[1])) {
        problemas.push(`${rel}:${i + 1} usa ${prop}: var(${token[1]}), que não é da escala — use ${permitidos.join(' · ')}.`);
      }
    }
  });
}

// ── 6. As cópias declaradas ainda batem com o token? ────────────────────────
for (const { arquivo, token, tema } of COPIAS_DECLARADAS) {
  const valor = (tema === 'escuro' ? escuro : claro).get(token);
  if (!valor) {
    problemas.push(`${arquivo} declara copiar ${token} (${tema}), e esse token não existe.`);
    continue;
  }
  const conteudo = readFileSync(join(RAIZ, arquivo), 'utf8').toLowerCase();
  if (!conteudo.includes(valor.toLowerCase())) {
    problemas.push(
      `${arquivo} deveria conter ${valor} — o valor de ${token} (${tema}) — e não contém. ` +
        `A cópia saiu de sincronia: o token mudou e este arquivo ficou para trás.`,
    );
  }
}

console.log(`Tokens: ${escuro.size} no escuro, ${claro.size} no claro.`);
console.log(`Contraste: ${PARES.length} pares conferidos por tema, mínimo ${MINIMO}:1.`);
console.log(
  `Escala fechada: ${ESCALA.fontSize.length} tamanhos, ${ESCALA.letterSpacing.length} trilhas, ${ESCALA.borderRadius.length} raios.`,
);
if (avisos.length) {
  console.log(`\nCópias vigiadas (${avisos.length}) — obrigatórias, e por isso rastreadas:`);
  for (const a of avisos) console.log(`  · ${a}`);
}
if (problemas.length) {
  console.log(`\nDivergências (${problemas.length}):`);
  for (const p of problemas) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nSem divergência: os dois temas cobrem os mesmos tokens e nenhuma tela inventa cor.');
