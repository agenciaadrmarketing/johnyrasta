import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { CONTA_A } from './setup-global';
import { entrar } from './apoio';

const unico = () => Math.random().toString(36).slice(2, 8);

/**
 * Aceite da Fase 4 de ponta a ponta: cria site, inicia diagnóstico, abre a
 * página de teste com o coletor REAL, clica e envia o formulário; depois
 * confere evidências na Instalação e que NADA disso entrou nos KPIs. Em
 * seguida repete SEM token: visita, clique e contato reais aparecem.
 */
test.describe('Fase 4 — coletor, formulários e contatos', () => {
  test.describe.configure({ mode: 'serial' });
  test('diagnóstico isolado e depois eventos reais aparecem; reenvio não duplica', async ({ page, context, request }) => {
    test.setTimeout(120_000);
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const s = unico();
    await page.goto('/clientes/novo?depois=site');
    await page.getByLabel('Nome do cliente').fill(`Col ${s}`);
    await page.getByRole('button', { name: /Cadastrar e adicionar site/ }).click();
    await page.getByLabel('Nome do site').fill(`Col ${s}`);
    await page.getByLabel('Endereço principal').fill(`col-${s}.com.br`);
    await page.getByRole('button', { name: 'Cadastrar site' }).click();
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}$/);
    const siteUrl = page.url();
    await page.getByRole('link', { name: 'Instalação' }).click();
    await page.getByRole('button', { name: 'Iniciar teste' }).click();
    const linkTeste = page.getByRole('link', { name: /\/teste\// });
    await expect(linkTeste).toBeVisible();
    const href = await linkTeste.getAttribute('href');
    const publicId = href!.match(/\/teste\/([^?]+)/)![1]!;

    // ── Diagnóstico: página de teste com token, coletor real ──
    const t = await context.newPage();
    await t.goto(href!);
    await expect(t.locator('text=Modo diagnóstico ativo')).toBeVisible();
    await t.waitForFunction(() => (window as unknown as { __jw?: string }).__jw === 'v1');
    await t.getByRole('button', { name: 'Botão genérico' }).click();
    await t.waitForTimeout(1200);
    await t.getByRole('button', { name: 'Enviar formulário de teste' }).click();
    await t.waitForLoadState('networkidle');
    await t.waitForTimeout(1200);
    await t.close();

    await page.reload();
    const evid = page.locator('dd', { has: page.locator('.selo-estado') }).last();
    await expect(evid.locator('.selo-estado[data-tom="ok"]')).toHaveCount(3, { timeout: 15_000 });
    // KPIs não mudaram.
    await page.goto(`${siteUrl}/botoes`);
    await expect(page.getByText('Nenhum evento real recebido')).toBeVisible();
    await page.goto(`${siteUrl}/contatos`);
    await expect(page.getByText('Nenhum contato recebido')).toBeVisible();

    // ── Real: a mesma página sem token ──
    const r = await context.newPage();
    await r.goto(`/teste/${publicId}`);
    await r.evaluate(() => { try { sessionStorage.removeItem('jw_t'); } catch {} });
    await r.reload();
    await r.waitForFunction(() => (window as unknown as { __jw?: string }).__jw === 'v1');
    await r.getByRole('button', { name: 'Botão genérico' }).click();
    await r.waitForTimeout(1200);
    await r.locator('input[name=email]').fill(`real-${s}@exemplo.com`);
    await r.getByRole('button', { name: 'Enviar formulário de teste' }).click();
    await r.waitForLoadState('networkidle');
    await r.close();

    await page.goto(`${siteUrl}/botoes`);
    await expect(page.getByText(/1 contatos recebidos|1 contato/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('td', { hasText: 'botao-generico' })).toBeVisible();
    await page.goto(`${siteUrl}/contatos`);
    await expect(page.locator('td', { hasText: `real-${s}@exemplo.com` }).first()).toBeVisible();
    await expect(page.locator('.selo-estado', { hasText: 'Contato recebido' }).first()).toBeVisible();
    await expect(page.getByText(/último clique: botao-generico/)).toBeVisible();

    // ── F01 pela API pública: reenvio idêntico → duplicated:true, um contato ──
    const sid = `sub-e2e-${s}-12345`;
    const corpo = { submission_id: sid, fields: { email: `dup-${s}@exemplo.com`, name: 'Dup' } };
    const a = await request.post(`/api/forms/${publicId}`, { data: corpo });
    const b = await request.post(`/api/forms/${publicId}`, { data: corpo });
    expect((await a.json()).duplicated).toBe(false);
    expect((await b.json()).duplicated).toBe(true);
    const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
    await c.connect();
    const n = await c.query('select count(*)::int as n from submissions where submission_id = $1', [sid]);
    const ct = await c.query("select count(*)::int as n from contact_identities where value = $1", [`dup-${s}@exemplo.com`]);
    await c.end();
    expect(n.rows[0].n).toBe(1);
    expect(ct.rows[0].n).toBe(1);

    // CSV com a mesma sessão.
    const csv = await page.request.get(`/api/exportar/contatos?site=${siteUrl.split('/').pop()}`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(`real-${s}@exemplo.com`);
  });

  test('endpoint público rejeita lixo e corpo grande sem derrubar; site desconhecido é 404', async ({ request }) => {
    expect((await request.post('/api/collect', { data: { site: 'nao-existe-123', events: [] } })).status()).toBe(404);
    expect((await request.post('/api/collect', { data: 'x', headers: { 'content-type': 'text/plain' } })).status()).toBe(400);
    expect((await request.post('/api/collect', { data: { site: 'x'.repeat(70_000), events: [] } })).status()).toBe(413);
    expect((await request.post('/api/forms/nao-existe-123', { data: { submission_id: 'abc12345678', fields: { email: 'a@b.co' } } })).status()).toBe(404);
  });
});
