/**
 * Mede o que o operador sente: login, listagem de sites e cada aba do site, em navegador real,
 * contra uma instalação já no ar (provisória ou final). Somente LEITURA e login.
 *
 *   MEDIR_BASE_URL=https://provisorio.exemplo.com MEDIR_EMAIL=… MEDIR_SENHA=… npm run medir
 *   opções: --repeticoes 5  --site <uuid>   (padrão: o primeiro site da lista)
 *
 * Credenciais só por ambiente (nunca por argumento). Para separar rede, servidor e banco:
 *   - "base" = tempo até o primeiro byte de /entrar (sem consulta ao banco): rede + Next ocioso;
 *   - TTFB da página − base ≈ trabalho do servidor (consultas ao banco incluídas);
 *   - "scrypt" = custo de CPU do login nesta máquina (parâmetros reais da central);
 *   - com DB_LOG_LENTO_MS=0 no processo web, o journal registra cada transação com a duração e o
 *     número de consultas, o que diz se a lentidão é banco (consultas × latência) ou CPU.
 */
import { chromium } from '@playwright/test';
import { hashPassword, verifyPassword } from '../src/modules/accounts/password';

const ABAS: [string, string][] = [['Resumo', ''], ['Disponibilidade', 'disponibilidade'], ['Velocidade', 'velocidade'], ['Contatos', 'contatos'], ['Botões e horários', 'botoes'], ['Instalação', 'instalacao']];

export function percentil(valores: number[], p: number): number {
  if (!valores.length) return NaN;
  const o = [...valores].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))]!;
}
const fmt = (n: number) => (Number.isFinite(n) ? `${n.toFixed(0)} ms` : '—');
function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

type Amostra = { ttfb: number; dcl: number; fim: number };

async function main() {
  const base = (process.env.MEDIR_BASE_URL ?? '').replace(/\/+$/, '');
  const email = process.env.MEDIR_EMAIL;
  const senha = process.env.MEDIR_SENHA;
  if (!base || !email || !senha) throw new Error('Defina MEDIR_BASE_URL, MEDIR_EMAIL e MEDIR_SENHA no ambiente.');
  const n = Math.max(1, Number(argumento('repeticoes') ?? 5));

  // CPU do login nesta máquina (não a do servidor medido!). Rode também NO servidor: `npm run medir -- --so-scrypt`.
  const h = await hashPassword('medicao-de-cpu');
  const cpu: number[] = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); await verifyPassword('medicao-de-cpu', h); cpu.push(performance.now() - t); }
  console.log(`scrypt (login, ${process.platform}): mediana ${fmt(percentil(cpu, 50))} nesta máquina`);
  if (process.argv.includes('--so-scrypt')) return;

  const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const medir = async (url: string): Promise<Amostra> => {
    await page.goto(url, { waitUntil: 'load' });
    // Tudo vem da Navigation Timing do próprio navegador (sem somar esperas do script).
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return e ? { ttfb: e.responseStart - e.startTime, dcl: e.domContentLoadedEventEnd - e.startTime, fim: e.loadEventEnd - e.startTime } : { ttfb: NaN, dcl: NaN, fim: NaN };
    });
    return nav;
  };

  try {
    const baseTtfb: number[] = [];
    for (let i = 0; i < n; i++) baseTtfb.push((await medir(`${base}/entrar`)).ttfb);

    const login: number[] = [];
    for (let i = 0; i < Math.min(n, 3); i++) {
      await ctx.clearCookies();
      await page.goto(`${base}/entrar`);
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Senha', { exact: true }).fill(senha);
      const t0 = performance.now();
      await page.getByRole('button', { name: 'Entrar' }).click();
      await page.waitForURL(/\/sites/);
      await page.waitForLoadState('load');
      login.push(performance.now() - t0);
    }

    const resultados: [string, Amostra[]][] = [];
    const lista: Amostra[] = [];
    for (let i = 0; i < n; i++) lista.push(await medir(`${base}/sites`));
    resultados.push(['Meus sites (listagem)', lista]);

    let siteId = argumento('site');
    if (!siteId) {
      await page.goto(`${base}/sites`);
      const href = await page.locator('a[href^="/sites/"]').first().getAttribute('href').catch(() => null);
      siteId = href?.match(/\/sites\/([0-9a-f-]{36})/)?.[1] ?? null;
    }
    if (!siteId) console.log('! Nenhum site cadastrado: as abas não foram medidas.');
    else for (const [rotulo, slug] of ABAS) {
      const a: Amostra[] = [];
      for (let i = 0; i < n; i++) a.push(await medir(`${base}/sites/${siteId}${slug ? `/${slug}` : ''}`));
      resultados.push([`Aba ${rotulo}`, a]);
    }

    const b50 = percentil(baseTtfb, 50);
    console.log(`\nBase (TTFB de /entrar, sem banco): mediana ${fmt(b50)}  p95 ${fmt(percentil(baseTtfb, 95))}`);
    console.log(`Login (clique → /sites carregado), ${login.length} medições: ${login.map(fmt).join(', ')}  (mediana ${fmt(percentil(login, 50))})\n`);
    console.log('| Tela | TTFB p50 | TTFB p95 | servidor ≈ (TTFB − base) | DOM p50 | carregada p50 | carregada p95 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const [nome, a] of resultados) {
      const t = a.map((x) => x.ttfb);
      console.log(`| ${nome} | ${fmt(percentil(t, 50))} | ${fmt(percentil(t, 95))} | ${fmt(percentil(t, 50) - b50)} | ${fmt(percentil(a.map((x) => x.dcl), 50))} | ${fmt(percentil(a.map((x) => x.fim), 50))} | ${fmt(percentil(a.map((x) => x.fim), 95))} |`);
    }
    console.log(`\n${n} repetições por tela (a primeira inclui aquecimento do servidor). Compare com o journal da web (DB_LOG_LENTO_MS=0) para ver consultas × latência.`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('medir-tempos.ts')) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
