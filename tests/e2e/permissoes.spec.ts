import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { CONTA_A, CONTA_B } from './setup-global';
import { entrar } from './apoio';

/**
 * A01 de ponta a ponta: com a conta A logada, TUDO que aponta para o site de B
 * (telas, exportações, relatório, ações) responde como se não existisse — 404,
 * nunca 403 — e nada muda no banco. A página pública de teste continua pública,
 * mas só revela o nome do site.
 *
 * O site de B (`public_id` 'e2e-pub-b') vem do setup-global. Este arquivo cria,
 * via banco, um contato em B e um site + contato em A para ter formulários
 * reais para adulterar.
 */

const unico = () => Math.random().toString(36).slice(2, 8);

async function pg<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

type Cenario = { siteB: string; publicB: string; contatoB: string; siteA: string; contatoA: string; nomeSiteA: string; emailA: string; userA: string };

async function prepararCenario(): Promise<Cenario> {
  return pg(async (c) => {
    const b = (await c.query<{ id: string; account_id: string; public_id: string }>("select id, account_id, public_id from sites where public_id = 'e2e-pub-b'")).rows[0]!;
    let contatoB = (await c.query<{ id: string }>('select id from contacts where site_id = $1 and anonymized_at is null limit 1', [b.id])).rows[0]?.id;
    if (!contatoB) {
      contatoB = (await c.query<{ id: string }>(`insert into contacts (account_id, site_id, name, first_real_at, last_real_at) values ($1, $2, 'Pessoa secreta de B', now(), now()) returning id`, [b.account_id, b.id])).rows[0]!.id;
      await c.query(`insert into contact_identities (account_id, site_id, contact_id, kind, value) values ($1, $2, $3, 'email', 'secreta-b@exemplo.com') on conflict do nothing`, [b.account_id, b.id, contatoB]);
    }
    const a = (await c.query<{ user_id: string; account_id: string }>('select u.id as user_id, u.account_id from users u where lower(u.email) = lower($1)', [CONTA_A.email])).rows[0]!;
    const s = unico();
    const cliente = (await c.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [a.account_id, `Cliente perm ${s}`])).rows[0]!.id;
    const nomeSiteA = `Site perm ${s}`;
    const siteA = (await c.query<{ id: string }>(
      `insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, $3, $4, $5, $6) returning id`,
      [a.account_id, cliente, nomeSiteA, `perm-${s}.exemplo.com`, `https://perm-${s}.exemplo.com/`, `e2e-perm-${s}`],
    )).rows[0]!.id;
    const emailA = `perm-${s}@exemplo.com`;
    const contatoA = (await c.query<{ id: string }>(`insert into contacts (account_id, site_id, name, first_real_at, last_real_at) values ($1, $2, 'Pessoa de A', now(), now()) returning id`, [a.account_id, siteA])).rows[0]!.id;
    await c.query(`insert into contact_identities (account_id, site_id, contact_id, kind, value) values ($1, $2, $3, 'email', $4)`, [a.account_id, siteA, contatoA, emailA]);
    return { siteB: b.id, publicB: b.public_id, contatoB, siteA, contatoA, nomeSiteA, emailA, userA: a.user_id };
  });
}

/** Troca o valor de um campo escondido antes do envio: é o que um cliente malicioso faria. */
async function adulterar(form: ReturnType<Page['locator']>, campo: string, valor: string) {
  await form.locator(`input[name="${campo}"]`).evaluate((el, v) => { (el as HTMLInputElement).value = v; }, valor);
}

test.describe('Permissões — A01 em todas as telas, exportações e ações', () => {
  let cen: Cenario;
  test.beforeAll(async () => { cen = await prepararCenario(); });

  test('telas do site de B respondem 404 com "Esta tela não existe aqui"; as de A abrem', async ({ page }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const rotas = ['', '/disponibilidade', '/velocidade', '/contatos', '/botoes', '/instalacao', '/editar'].map((r) => `/sites/${cen.siteB}${r}`);
    rotas.push(`/relatorios/site/${cen.siteB}`);
    for (const rota of rotas) {
      const resp = await page.goto(rota);
      expect(resp?.status(), rota).toBe(404);
      await expect(page.getByText('Esta tela não existe aqui'), rota).toBeVisible();
      await expect(page.getByText('Site secreto de B')).toHaveCount(0);
    }
    // Sanidade: o mesmo caminho, no site de A, abre.
    const ok = await page.goto(`/sites/${cen.siteA}/contatos`);
    expect(ok?.status()).toBe(200);
    await expect(page.locator('td', { hasText: cen.emailA })).toBeVisible();
  });

  test('exportações: site de B é 404 com a sessão de A; sem sessão, 401', async ({ page, request }) => {
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    expect((await page.request.get(`/api/exportar/contatos?site=${cen.siteB}`)).status()).toBe(404);
    expect((await page.request.get(`/api/exportar/eventos?site=${cen.siteB}`)).status()).toBe(404);
    const proprio = await page.request.get(`/api/exportar/contatos?site=${cen.siteA}`);
    expect(proprio.status()).toBe(200);
    expect(await proprio.text()).toContain(cen.emailA);
    expect(await proprio.text()).not.toContain('secreta-b@exemplo.com');
    // `request` é um contexto sem cookies: ninguém logado.
    expect((await request.get('/api/exportar/contatos')).status()).toBe(401);
    expect((await request.get(`/api/exportar/contatos?site=${cen.siteB}`)).status()).toBe(401);
    expect((await request.get(`/api/exportar/eventos?site=${cen.siteB}`)).status()).toBe(401);
  });

  test('ações com id de B (favoritar, arquivar, excluir contato, retenção) não mudam nada no banco', async ({ page }) => {
    test.setTimeout(90_000);
    await entrar(page, CONTA_A.email, CONTA_A.senha);
    const politicaAntes = await pg(async (c) => (await c.query('select contact_retention_policy, contact_retention_days from site_tracking where site_id = $1', [cen.siteB])).rows[0] ?? null);

    // Favoritar: o formulário da linha de A, com o id trocado pelo de B.
    await page.goto(`/sites?q=perm-${cen.nomeSiteA.split(' ').pop()}`);
    const linha = page.getByTestId('linha-projeto').filter({ hasText: cen.nomeSiteA });
    await expect(linha).toHaveCount(1);
    await adulterar(linha.locator('form'), 'id', cen.siteB);
    await linha.getByRole('button', { name: /favorito/ }).click();
    await page.waitForLoadState('networkidle');
    expect(await pg(async (c) => (await c.query<{ n: number }>('select count(*)::int as n from site_favorites where site_id = $1', [cen.siteB])).rows[0]!.n)).toBe(0);
    // O mesmo gesto, sem adulterar, funciona — logo o teste acima não é vazio.
    await page.reload();
    await page.getByTestId('linha-projeto').filter({ hasText: cen.nomeSiteA }).getByRole('button', { name: /favorito/ }).click();
    await expect(page.getByTestId('linha-projeto').filter({ hasText: cen.nomeSiteA }).getByRole('button', { name: /favorito/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await pg(async (c) => (await c.query<{ n: number }>('select count(*)::int as n from site_favorites where site_id = $1 and user_id = $2', [cen.siteA, cen.userA])).rows[0]!.n)).toBe(1);

    // Arquivar: o formulário do resumo de A, com o id trocado pelo de B.
    await page.goto(`/sites/${cen.siteA}`);
    const arquivar = page.locator('form', { has: page.getByRole('button', { name: 'Arquivar projeto' }) });
    await adulterar(arquivar, 'id', cen.siteB);
    await arquivar.getByRole('button', { name: 'Arquivar projeto' }).click();
    await page.waitForLoadState('networkidle');
    const arquivados = await pg(async (c) => (await c.query<{ id: string }>('select id from sites where id = any($1) and archived_at is not null', [[cen.siteA, cen.siteB]])).rows.map((r) => r.id));
    expect(arquivados).toEqual([]);

    // Excluir contato: formulário da aba Contatos de A, apontando para o site e o contato de B.
    await page.goto(`/sites/${cen.siteA}/contatos`);
    const linhaContato = page.locator('tr', { hasText: cen.emailA });
    await linhaContato.locator('summary', { hasText: 'Excluir' }).click();
    const excluir = linhaContato.locator('form', { has: page.getByRole('button', { name: 'Excluir (anonimiza)' }) });
    await adulterar(excluir, 'site', cen.siteB);
    await adulterar(excluir, 'id', cen.contatoB);
    await excluir.getByRole('button', { name: 'Excluir (anonimiza)' }).click();
    await page.waitForLoadState('networkidle');
    const b = await pg(async (c) => (await c.query('select name, anonymized_at, (select count(*)::int from contact_identities i where i.contact_id = contacts.id) as ids from contacts where id = $1', [cen.contatoB])).rows[0]!);
    expect(b.anonymized_at).toBeNull();
    expect(b.name).not.toBeNull();
    expect(b.ids).toBeGreaterThan(0);
    await expect(page.getByText('Contato excluído')).toHaveCount(0);

    // Retenção: a política de B não muda por um formulário de A.
    const retencao = page.locator('#retencao form');
    await adulterar(retencao, 'site', cen.siteB);
    await retencao.locator('select[name="policy"]').selectOption('dias');
    await retencao.locator('input[name="dias"]').fill('45');
    await retencao.getByRole('button', { name: 'Salvar política' }).click();
    await page.waitForLoadState('networkidle');
    const politicaDepois = await pg(async (c) => (await c.query('select contact_retention_policy, contact_retention_days from site_tracking where site_id = $1', [cen.siteB])).rows[0] ?? null);
    expect(politicaDepois).toEqual(politicaAntes);
    await expect(page.getByText('Política de retenção salva')).toHaveCount(0);

    // E a exclusão legítima, no próprio contato de A, funciona: anonimiza e avisa.
    await page.goto(`/sites/${cen.siteA}/contatos`);
    await page.locator('tr', { hasText: cen.emailA }).locator('summary', { hasText: 'Excluir' }).click();
    await page.getByRole('button', { name: 'Excluir (anonimiza)' }).click();
    await expect(page.getByText('Contato excluído')).toBeVisible();
    await expect(page.locator('td', { hasText: cen.emailA })).toHaveCount(0);
    const a = await pg(async (c) => (await c.query('select name, anonymized_at, deletion_reason, (select count(*)::int from contact_identities i where i.contact_id = contacts.id) as ids from contacts where id = $1', [cen.contatoA])).rows[0]!);
    expect(a).toMatchObject({ name: null, deletion_reason: 'manual', ids: 0 });
    expect(a.anonymized_at).not.toBeNull();
    const auditoria = await pg(async (c) => (await c.query("select details from audit_log where action = 'contato.excluir' and target_id = $1", [cen.contatoA])).rows[0]!);
    expect(auditoria.details).toMatchObject({ motivo: 'manual', identidades: 1 });
    expect(JSON.stringify(auditoria.details)).not.toContain(cen.emailA);
  });

  test('a página pública /teste/<publicId de B> continua acessível, sem sessão, e só revela o nome do site', async ({ request }) => {
    const r = await request.get(`/teste/${cen.publicB}`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain('Site secreto de B');
    expect(html).not.toContain('secreto-b.exemplo.com');
    expect(html).not.toContain('Cliente secreto de B');
    expect(html).not.toContain('secreta-b@exemplo.com');
    expect(html).not.toContain('Pessoa secreta de B');
    expect(html).not.toContain(cen.siteB);
    // E um publicId que não existe é 404, sem distinguir "inexistente" de "arquivado".
    expect((await request.get('/teste/nao-existe-123')).status()).toBe(404);
  });

  test('B continua vendo o próprio site e o próprio contato', async ({ page }) => {
    await entrar(page, CONTA_B.email, CONTA_B.senha);
    await page.goto(`/sites/${cen.siteB}/contatos`);
    await expect(page.locator('h1')).toHaveText('Site secreto de B');
    await expect(page.locator('td', { hasText: 'Pessoa secreta de B' }).or(page.locator('td', { hasText: 'secreta-b@exemplo.com' })).first()).toBeVisible();
  });
});
