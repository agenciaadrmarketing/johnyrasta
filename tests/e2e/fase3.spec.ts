import { expect, test } from '@playwright/test';
import { CONTA_A } from './setup-global';
import { entrar } from './apoio';

const unico = () => Math.random().toString(36).slice(2, 8);

test.describe('Fase 3 — velocidade', () => {
  test('escolhe URLs do próprio domínio (até 3), recusa outro domínio e duplicata; sem chave, nada finge medição', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const s = unico();
    await page.goto('/clientes/novo?depois=site');
    await page.getByLabel('Nome do cliente').fill(`Vel ${s}`);
    await page.getByRole('button', { name: /Cadastrar e adicionar site/ }).click();
    await page.getByLabel('Nome do site').fill(`Vel ${s}`);
    await page.getByLabel('Endereço principal').fill(`vel-${s}.com.br`);
    await page.getByRole('button', { name: 'Cadastrar site' }).click();
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]{36}$/);
    await page.getByRole('link', { name: 'Velocidade' }).click();
    await expect(page.getByText(/URLs prioritárias \(0 de 3\)/)).toBeVisible();

    const adicionar = async (url: string) => {
      await page.getByLabel('URL prioritária').fill(url);
      await page.getByRole('button', { name: 'Adicionar URL' }).click();
    };
    await adicionar(`https://outro-${s}.com/`);
    await expect(page.getByRole('alert').first()).toContainText('domínio deste site');
    await adicionar(`https://www.vel-${s}.com.br/`);
    await expect(page.getByText(/URLs prioritárias \(1 de 3\)/)).toBeVisible();
    await adicionar(`https://www.vel-${s}.com.br/?utm=x`);
    await expect(page.getByRole('alert').first()).toContainText('já está na lista');
    await adicionar(`https://vel-${s}.com.br/contato`);
    await expect(page.getByText(/URLs prioritárias \(2 de 3\)/)).toBeVisible();
    await adicionar(`https://vel-${s}.com.br/campanha`);
    await expect(page.getByText(/URLs prioritárias \(3 de 3\)/)).toBeVisible();
    await expect(page.getByLabel('URL prioritária')).toHaveCount(0);
    // Nenhuma nota inventada: todas as séries aguardam.
    await expect(page.locator('.kpi-numero')).toHaveCount(0);
    await expect(page.getByText(/Aguardando/).first()).toBeVisible();
    await expect(page.getByText('Dados insuficientes')).toBeVisible();
    // Remover libera a vaga.
    await page.getByRole('button', { name: 'Remover' }).first().click();
    await expect(page.getByText(/URLs prioritárias \(2 de 3\)/)).toBeVisible();
  });
});
