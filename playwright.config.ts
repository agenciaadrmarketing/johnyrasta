import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de navegador contra `next start` (build de produção): é o pacote que
 * vai ao ar, com a CSP ligada. `next dev` compila com `eval` e não representa.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/setup-global.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    // Ambiente com Chromium pré-instalado fora da versão do pacote: aponte o binário.
    launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://127.0.0.1:3100/entrar',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { ...process.env, NODE_ENV: 'production' },
  },
});
