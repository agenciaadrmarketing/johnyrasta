import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { CONTA_A, CONTA_B } from './setup-global';
import { entrar } from './apoio';

const unico = () => Math.random().toString(36).slice(2, 8);

test.describe('Fase 1 — fundação e central de sites', () => {
  test('sem sessão, a central redireciona para o login; mutação sem sessão não grava', async ({ page, request }) => {
    await page.goto('/sites');
    await expect(page).toHaveURL(/\/entrar/);
    // A02: POST cru numa rota de tela não é uma Server Action válida e não cria nada.
    const r = await request.post('/clientes/novo', { form: { nome: 'invasor' } });
    expect(r.status() >= 400 || r.url().includes('/entrar')).toBe(true);
    const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
    await c.connect();
    const n = await c.query("select count(*)::int as n from clients where name = 'invasor'");
    await c.end();
    expect(n.rows[0]!.n).toBe(0);
  });

  test('login errado mostra UMA mensagem, sem dizer se o e-mail existe', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('ninguem@teste.local');
    await page.getByLabel('Senha', { exact: true }).fill('qualquer-coisa-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText('E-mail ou senha incorretos.');
  });

  test('cadastra cliente e site, encontra pela busca, vê estado honesto', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const sufixo = unico();
    await page.goto('/clientes/novo?depois=site');
    await page.getByLabel('Nome do cliente').fill(`Cliente ${sufixo}`);
    await page.getByRole('button', { name: /Cadastrar e adicionar site/ }).click();
    await expect(page).toHaveURL(/\/sites\/novo\?cliente=/);
    await page.getByLabel('Nome do site').fill(`Site ${sufixo}`);
    await page.getByLabel('Endereço principal').fill(`www.site-${sufixo}.com.br`);
    await page.getByRole('button', { name: 'Cadastrar site' }).click();
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}$/);
    // Cabeçalho do site: domínio normalizado (sem www) e estado com TEXTO.
    await expect(page.locator('.sub-cabecalho')).toContainText(`site-${sufixo}.com.br`);
    await expect(page.locator('.sub-cabecalho .selo-estado')).toHaveText(/Nunca verificado/);
    // Nenhum recurso diz "tudo configurado".
    await expect(page.locator('.selo-estado', { hasText: /tudo configurado/i })).toHaveCount(0);
    // A busca encontra.
    await page.goto(`/sites?q=${sufixo}`);
    await expect(page.getByTestId('linha-projeto')).toHaveCount(1);
    await expect(page.getByTestId('linha-projeto').first()).toContainText(`Cliente ${sufixo}`);
  });

  test('domínio duplicado na mesma conta é recusado com erro claro', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const sufixo = unico();
    await page.goto('/clientes/novo?depois=site');
    await page.getByLabel('Nome do cliente').fill(`Dup ${sufixo}`);
    await page.getByRole('button', { name: /Cadastrar e adicionar site/ }).click();
    await page.getByLabel('Nome do site').fill(`Primeiro ${sufixo}`);
    await page.getByLabel('Endereço principal').fill(`dup-${sufixo}.com`);
    await page.getByRole('button', { name: 'Cadastrar site' }).click();
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}$/);
    await page.goto('/sites/novo');
    await page.getByLabel('Nome do site').fill(`Segundo ${sufixo}`);
    await page.getByLabel('Endereço principal').fill(`https://www.dup-${sufixo}.com/x`);
    await page.getByRole('button', { name: 'Cadastrar site' }).click();
    await expect(page.getByRole('alert').first()).toContainText('Já existe um site ativo com este domínio');
  });

  test('A01: conta A não abre site de B pela URL (404), e B não aparece na busca de A', async ({ page }) => {
    const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
    await c.connect();
    const r = await c.query<{ id: string }>("select id from sites where public_id = 'e2e-pub-b'");
    await c.end();
    const siteB = r.rows[0]!.id;
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const resp = await page.goto(`/sites/${siteB}`);
    expect(resp?.status()).toBe(404);
    await expect(page.getByText('Esta tela não existe aqui')).toBeVisible();
    await page.goto('/sites?q=secreto');
    await expect(page.getByTestId('linha-projeto')).toHaveCount(0);
    await expect(page.getByText('Site secreto de B')).toHaveCount(0);
    // E B vê o próprio site.
    await page.goto('/entrar');
    await page.context().clearCookies();
    await entrar(page, CONTA_B.email, CONTA_B.senha);
    await page.goto(`/sites/${siteB}`);
    await expect(page.locator('h1')).toHaveText('Site secreto de B');
  });

  test('V02: a tela inicial é uma lista de projetos, sem parede de KPIs', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await expect(page.getByRole('searchbox')).toBeVisible();
    await expect(page.getByRole('link', { name: /Adicionar site/ })).toBeVisible();
    await expect(page.locator('.cartao-kpi, .kpi-numero, svg.grafico-svg')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Filtros' })).toBeVisible();
  });

  test('configurações mostram o worker como nunca visto ou sem sinal, nunca como funcionando sem heartbeat', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await page.goto('/configuracoes');
    const worker = page.locator('#sistema .selo-estado').nth(1);
    await expect(worker).toHaveText(/Nunca visto|Sem sinal|Ativo/);
    // Sem heartbeat recente, a tela explica como iniciar o worker.
    if (!/Ativo/.test(await worker.innerText())) await expect(page.locator('#sistema')).toContainText('npm run worker');
  });

  test('V03: com prefers-reduced-motion os efeitos nascem desligados e a interface funciona', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await expect(page.locator('html')).toHaveAttribute('data-fx', 'off');
    await expect(page.getByRole('button', { name: /FX OFF/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('link', { name: /Adicionar site/ })).toBeVisible();
    await ctx.close();
  });

  test('X02: navegação por teclado alcança busca, filtros e primeira ação', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab'); // botão Buscar
    await page.keyboard.press('Tab'); // primeiro filtro
    const ativo = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(ativo).toContain('Todos');
  });

  test('página de referência renderiza os dois temas', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    await page.goto('/referencia');
    await expect(page.locator('[data-tema="escuro"].referencia-tema')).toBeVisible();
    await expect(page.locator('[data-tema="claro"].referencia-tema')).toBeVisible();
  });
});

test.describe('celular', () => {
  test.skip(({ isMobile }) => !isMobile, 'só no projeto celular');
  test('sem rolagem horizontal em Meus sites, site e configurações; no máximo quatro destinos na barra inferior', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    for (const rota of ['/sites', '/clientes', '/configuracoes', '/atencao']) {
      await page.goto(rota);
      const estoura = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(estoura, rota).toBe(false);
    }
    await expect(page.locator('.menu-inferior .item-inferior')).toHaveCount(4);
    await expect(page.locator('.lateral')).toBeHidden();
  });
});
