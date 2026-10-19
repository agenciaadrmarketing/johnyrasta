import type { Page } from '@playwright/test';

export async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/sites/);
}
