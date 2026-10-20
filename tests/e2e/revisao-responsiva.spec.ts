import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CONTA_A } from './setup-global';
import { entrar } from './apoio';
import { NOME_CLIENTE, NOME_SITE, semearRevisao } from './semente-revisao';

/**
 * Revisão funcional e responsiva (notebook e celular): todas as telas da central com dados reais de
 * revisão, sem rolagem horizontal, sem erro de console/página e sem resposta 4xx/5xx inesperada.
 * Capturas em REVISAO_CAPTURAS (se definida) para inspeção visual.
 */
const PASTA = process.env.REVISAO_CAPTURAS;
let ids: Awaited<ReturnType<typeof semearRevisao>>;

test.beforeAll(async () => { ids = await semearRevisao(); });

async function enviarEventos(page: Page) {
  // Pelos endpoints PÚBLICOS reais: visitas, cliques e um formulário com contato.
  const agora = Date.now();
  const sk = 'revisao-sessao-' + Math.random().toString(36).slice(2, 10);
  const ev = (type: string, extra: Record<string, unknown>, ms: number) => ({ event_id: 'rv' + Math.random().toString(36).slice(2, 12), session_key: sk, type, path: '/contato', occurred_at: new Date(agora - ms).toISOString(), device: 'celular', ...extra });
  const r = await page.request.post(`/api/collect`, {
    headers: { 'content-type': 'text/plain' },
    data: JSON.stringify({ site: ids.publicId, events: [ev('page_view', {}, 120_000), ev('click', { button_id: 'cta-whatsapp', button_pos: 'topo', action_kind: 'whatsapp', button_text: 'Falar no WhatsApp' }, 90_000), ev('click', { button_id: 'cta-orcamento', button_pos: 'rodape', action_kind: 'form' }, 60_000)] }),
  });
  expect([200, 204]).toContain(r.status());
  const f = await page.request.post(`/api/forms/${ids.publicId}`, {
    data: { submission_id: 'revisao-' + Math.random().toString(36).slice(2, 12), session_key: sk, page_path: '/contato', fields: { name: 'Maria Revisão', email: `maria${Date.now()}@exemplo.com`, phone: '11988887777' } },
  });
  expect(f.status()).toBe(200);
}

async function visitar(page: Page, rotulo: string, rota: string, projeto: string) {
  const problemas: string[] = [];
  const aoErro = (e: Error) => problemas.push(`pageerror: ${e.message}`);
  const aoConsole = (m: import('@playwright/test').ConsoleMessage) => { if (m.type() === 'error') problemas.push(`console: ${m.text()}`); };
  const aoResposta = (r: import('@playwright/test').Response) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) problemas.push(`HTTP ${r.status()} ${r.url()}`);
  };
  page.on('pageerror', aoErro); page.on('console', aoConsole); page.on('response', aoResposta);
  await page.goto(rota, { waitUntil: 'load' });
  await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  const estouro = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  page.off('pageerror', aoErro); page.off('console', aoConsole); page.off('response', aoResposta);
  if (PASTA) { mkdirSync(PASTA, { recursive: true }); await page.screenshot({ path: `${PASTA}/${projeto}-${rotulo}.png`, fullPage: true }); }
  expect(estouro.sw, `${rotulo}: rolagem horizontal (${estouro.sw} > ${estouro.cw})`).toBeLessThanOrEqual(estouro.cw + 1);
  expect(problemas, `${rotulo}: ${problemas.join(' | ')}`).toEqual([]);
}

test.describe('revisão funcional e responsiva', () => {
  test('todas as telas abrem sem estouro horizontal, erro de console ou HTTP 4xx/5xx', async ({ page }, info) => {
    test.setTimeout(240_000);
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await enviarEventos(page);
    const s = `/sites/${ids.siteId}`;
    const telas: [string, string][] = [
      ['meus-sites', '/sites'], ['atencao', '/atencao'], ['clientes', '/clientes'], ['cliente', `/clientes/${ids.clienteId}`], ['cliente-novo', '/clientes/novo'],
      ['site-novo', '/sites/novo'], ['site-resumo', s], ['site-disponibilidade', `${s}/disponibilidade`], ['site-velocidade', `${s}/velocidade`], ['site-contatos', `${s}/contatos`],
      ['site-botoes', `${s}/botoes`], ['site-instalacao', `${s}/instalacao`], ['site-editar', `${s}/editar`], ['relatorios', '/relatorios'],
      ['relatorio-site', `/relatorios/site/${ids.siteId}`], ['relatorio-cliente', `/relatorios/cliente/${ids.clienteId}`], ['configuracoes', '/configuracoes'], ['referencia', '/referencia'],
    ];
    for (const [rotulo, rota] of telas) await visitar(page, rotulo, rota, info.project.name);
  });

  test('os dados semeados e enviados aparecem onde devem (disponibilidade, velocidade, botões, contatos, relatório)', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const s = `/sites/${ids.siteId}`;
    await page.goto(`${s}/disponibilidade`);
    await expect(page.getByText(/HTTP 503|503/).first()).toBeVisible();
    await page.goto(`${s}/velocidade`);
    await expect(page.getByText(/71|52/).first()).toBeVisible();
    await expect(page.getByText(/possível regressão/i).first()).toBeVisible();
    await page.goto(`${s}/botoes`);
    await expect(page.getByText('cta-whatsapp').first()).toBeVisible();
    await page.goto(`${s}/contatos`);
    await expect(page.getByText(/Maria Revisão/).first()).toBeVisible();
    await page.goto(`/relatorios/site/${ids.siteId}`);
    await expect(page.getByRole('heading', { name: new RegExp(NOME_SITE) }).first()).toBeVisible();
  });

  test('editar cliente e site pela interface e restaurar; a busca encontra pelo nome novo', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await page.goto(`/sites/${ids.siteId}/editar`);
    await page.getByLabel('Nome do site').fill(`${NOME_SITE} (editado)`);
    await page.getByRole('button', { name: /Salvar/ }).first().click();
    await page.waitForLoadState('networkidle');
    await page.goto('/sites');
    await page.getByRole('searchbox').or(page.getByPlaceholder(/Buscar|buscar/)).first().fill('(editado)');
    await expect(page.getByText(`${NOME_SITE} (editado)`).first()).toBeVisible();
    await page.goto(`/sites/${ids.siteId}/editar`);
    await page.getByLabel('Nome do site').fill(NOME_SITE);
    await page.getByRole('button', { name: /Salvar/ }).first().click();
    await page.waitForLoadState('networkidle');
    await page.goto(`/clientes/${ids.clienteId}`);
    await expect(page.getByText(NOME_CLIENTE).first()).toBeVisible();
  });

  test('tema claro e efeitos Matrix ligados não quebram o layout (sem estouro nem erro)', async ({ page }, info) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await page.goto('/sites');
    await page.getByRole('button', { name: /FX OFF|FX ON/ }).first().click();
    await page.getByRole('button', { name: /tema claro|tema escuro/ }).first().click();
    await visitar(page, 'sites-claro-fx', '/sites', info.project.name);
    await visitar(page, 'site-claro-fx', `/sites/${ids.siteId}`, info.project.name);
  });
});
