import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Ciclo de vida do submission_id e da session_key no formulário AJAX, com o
 * coletor REAL (public/c.v1.js) num Chromium e relógio controlado. Não usa a central:
 * as páginas e o endpoint de coleta são simulados por rota.
 */
const COLETOR = readFileSync('public/c.v1.js', 'utf8');
const PAGINA = `<!doctype html><html><body>
<form id="f" data-track-form="contato">
  <input type="hidden" name="submission_id" value="">
  <input type="hidden" name="session_key" value="">
  <input name="email" value="a@ex.com">
  <button type="submit">Enviar</button>
</form>
<script src="https://central.test/c.v1.js" data-site="pub-teste-1"></script>
<script>
  window.enviados = [];
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault(); // AJAX: a página permanece
    var f = e.target;
    window.enviados.push({ sid: f.submission_id.value, sk: f.session_key.value });
  });
</script></body></html>`;

async function abrir(page: Page) {
  await page.route('https://site.test/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGINA }));
  await page.route('https://central.test/c.v1.js', (r) => r.fulfill({ contentType: 'application/javascript', body: COLETOR }));
  await page.route('https://central.test/api/collect', (r) => r.fulfill({ status: 204 }));
  await page.clock.install({ time: new Date('2026-10-20T10:00:00Z') });
  await page.goto('https://site.test/contato');
  await page.waitForFunction(() => (window as unknown as { __jw?: string }).__jw === 'v1');
}
const enviar = (page: Page) => page.click('button[type=submit]');
const enviados = (page: Page) => page.evaluate(() => (window as unknown as { enviados: { sid: string; sk: string }[] }).enviados);

test.describe('coletor — formulário AJAX na mesma página', () => {
  test('A) depois de concluído (form.reset ou jw("submitted")), o próximo envio recebe outro submission_id', async ({ page }) => {
    await abrir(page);
    await enviar(page);
    await page.evaluate(() => (document.getElementById('f') as HTMLFormElement).reset()); // integração confirmou sucesso
    await enviar(page);
    await page.evaluate(() => (window as unknown as { jw: (c: string, a: string) => void }).jw('submitted', 'contato')); // aviso explícito
    await enviar(page);
    const [a, b, c] = await enviados(page);
    expect(a!.sid).toMatch(/^sub/);
    expect(new Set([a!.sid, b!.sid, c!.sid]).size).toBe(3);
  });

  test('B) tentativa de resultado incerto (nenhum aviso) mantém o submission_id', async ({ page }) => {
    await abrir(page);
    await enviar(page);
    await enviar(page); // reenvio depois de erro de rede, sem confirmação
    const [a, b] = await enviados(page);
    expect(a!.sid).toBeTruthy();
    expect(b!.sid).toBe(a!.sid);
  });

  test('B2) submission_id posto pelo próprio site nunca é alterado nem descartado', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => { (document.getElementById('f') as HTMLFormElement).submission_id.value = 'id-do-site-0001'; });
    await enviar(page);
    await page.evaluate(() => (window as unknown as { jw: (c: string, a: string) => void }).jw('submitted', 'contato'));
    await enviar(page);
    const [a, b] = await enviados(page);
    expect([a!.sid, b!.sid]).toEqual(['id-do-site-0001', 'id-do-site-0001']);
  });

  test('C) depois de 30 min de inatividade o envio usa a sessão atual, não a chave antiga do campo', async ({ page }) => {
    await abrir(page);
    await enviar(page);
    await page.clock.fastForward(31 * 60 * 1000);
    await enviar(page);
    const [a, b] = await enviados(page);
    const atual = await page.evaluate(() => (window as unknown as { jw: (c: string) => string }).jw('session'));
    expect(a!.sk).toBeTruthy();
    expect(b!.sk).not.toBe(a!.sk);
    expect(b!.sk).toBe(atual);
  });
});
