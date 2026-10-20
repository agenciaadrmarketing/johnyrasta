import { expect, test } from '@playwright/test';

test.describe('Fase 6 — recuperação de senha', () => {
  test('login leva à recuperação; sem provedor a tela diz o motivo em vez de fingir que enviou', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
    await expect(page).toHaveURL(/\/recuperar-senha$/);
    await expect(page.getByText(/não está configurado|modo de log|APP_URL/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar link' })).toHaveCount(0);
  });
  test('link inventado é recusado sem mostrar formulário', async ({ page }) => {
    await page.goto('/redefinir-senha?token=inventado');
    await expect(page.getByText(/inválido, venceu ou já foi usado/)).toBeVisible();
    await expect(page.getByLabel('Senha nova')).toHaveCount(0);
  });
});
