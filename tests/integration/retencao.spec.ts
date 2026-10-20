import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';
import { receberSubmissao, siteDeFormulario, type EntradaDeSubmissao } from '@/modules/contacts/recepcao';
import { aplicarRetencao, excluirContatoNoBanco, lerPoliticaDeRetencao, validarPolitica } from '@/modules/contacts/retencao';
import { listarContatos, listarSubmissoes } from '@/modules/contacts/consultas';
import type { Queryable } from '@/shared/db';

/**
 * Exclusão (anonimização) e retenção de contatos, contra o Postgres real:
 * a central exclui como app_web (RLS), o worker varre como app_worker
 * (privilégio por coluna), e os formulários chegam como app_forms.
 *
 *   TEST_DB_NAME=johnyweb_test_perm npx vitest run tests/integration/retencao.spec.ts
 */

function wrap(pool: Pool) {
  return async <T,>(fn: (db: Queryable) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    const q: Queryable = { query: async (s, p = []) => (await c.query(s, p)).rows, one: async (s, p = []) => (await c.query(s, p)).rows[0] ?? null };
    try { await c.query('begin'); const r = await fn(q); await c.query('commit'); return r; } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  };
}
const poolDe = (env: string) => { const u = new URL(process.env[env]!); u.pathname = `/${BANCO_TESTE}`; return new Pool({ connectionString: u.toString(), max: 4 }); };
/** Queryable sobre a conexão de `comoConta` (app_web + SET LOCAL app.account_id). */
const sobre = (c: { query: Client['query'] }): Queryable => ({ query: async (s, p = []) => (await c.query(s, p)).rows, one: async (s, p = []) => (await c.query(s, p)).rows[0] ?? null });

let admin: Client; let web: Pool; let forms: Pool; let worker: Pool;
let comForms: ReturnType<typeof wrap>;
let A: { accountId: string; userId: string }; let B: { accountId: string; userId: string };
let site1: string; let site2: string;
const PUB1 = 'pub-ret-1'; const PUB2 = 'pub-ret-2';
const sub = (o: Partial<EntradaDeSubmissao> & Pick<EntradaDeSubmissao, 'fields'>): EntradaDeSubmissao => ({ submission_id: 'sub-' + randomBytes(6).toString('hex'), page_path: '/contato', ...o });
const receber = (pub: string, e: EntradaDeSubmissao) => comForms(async (db) => receberSubmissao(db, (await siteDeFormulario(db, pub))!, e, 'endpoint', new Date()));
const contatoDe = async (kind: 'email' | 'phone', value: string) => (await admin.query<{ contact_id: string }>('select contact_id from contact_identities where kind = $1 and value = $2', [kind, value])).rows[0]!.contact_id;
const contato = async (id: string) => (await admin.query('select name, first_real_at, last_real_at, deleted_at, anonymized_at, deletion_reason from contacts where id = $1', [id])).rows[0]!;
const identidades = async (id: string) => (await admin.query('select count(*)::int as n from contact_identities where contact_id = $1', [id])).rows[0]!.n as number;
const envios = (id: string) => admin.query('select id, fields, occurred_at, page_path, attribution, is_new_lead, attributed_event_id from submissions where contact_id = $1 order by occurred_at, id', [id]);

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  // As consultas da tela (`listarContatos`) usam o pool da central: aponta-o para o banco de teste ANTES do primeiro uso.
  process.env.DATABASE_URL = u.web;
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  forms = poolDe('DATABASE_URL_FORMS'); worker = poolDe('DATABASE_URL_WORKER');
  comForms = wrap(forms);
  A = await criarConta(admin, 'Conta A'); B = await criarConta(admin, 'Conta B');
  const cl = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [A.accountId, 'Cliente']);
  const s1 = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Site 1', 'um.exemplo.com', 'https://um.exemplo.com/', $3) returning id`, [A.accountId, cl.rows[0]!.id, PUB1]);
  const s2 = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Site 2', 'dois.exemplo.com', 'https://dois.exemplo.com/', $3) returning id`, [A.accountId, cl.rows[0]!.id, PUB2]);
  site1 = s1.rows[0]!.id; site2 = s2.rows[0]!.id;
  await admin.query('insert into site_tracking (site_id, account_id) values ($1, $2), ($3, $2)', [site1, A.accountId, site2]);
  // Massa do site 1: Ana (e-mail + telefone, 3 envios), Bruno (telefone), e um conflito Ana×Bruno.
  await receber(PUB1, sub({ fields: { name: 'Ana', email: 'ana@ex.com', phone: '11 98888-7777' } }));
  await receber(PUB1, sub({ fields: { email: 'ana@ex.com' }, page_path: '/orcamento' }));
  await receber(PUB1, sub({ fields: { name: 'Bruno', phone: '11 97777-6666' } }));
  await receber(PUB1, sub({ fields: { email: 'ana@ex.com', phone: '(11) 97777-6666' } }));
});

afterAll(async () => {
  await globalThis.__johnyPools?.get('DATABASE_URL')?.end();
  await forms.end(); await worker.end(); await web.end(); await admin.end();
});

describe('excluir contato (anonimização)', () => {
  let ana: string; let bruno: string;
  let antes: Awaited<ReturnType<typeof envios>>['rows'];
  let anaAntes: Awaited<ReturnType<typeof contato>>;

  it('remove identidades e nome, zera os campos dos envios, fecha o conflito — e mantém contagens, horários e atribuição', async () => {
    ana = await contatoDe('email', 'ana@ex.com'); bruno = await contatoDe('phone', '+5511977776666');
    expect(ana).not.toBe(bruno);
    antes = (await envios(ana)).rows; anaAntes = await contato(ana);
    expect(antes).toHaveLength(3);
    expect(await identidades(ana)).toBe(2);
    expect((await admin.query('select count(*)::int as n from contact_conflicts where resolved_at is null')).rows[0]!.n).toBe(1);
    const totalEnvios = (await admin.query('select count(*)::int as n from submissions where site_id = $1', [site1])).rows[0]!.n;

    const r = await comoConta(web, A.accountId, (c) => excluirContatoNoBanco(sobre(c), { accountId: A.accountId, siteId: site1, contactId: ana, motivo: 'manual' }));
    expect(r).toEqual({ excluido: true, identidades: 2, submissoes: 3, conflitos: 1 });

    const depois = await contato(ana);
    expect(depois.name).toBeNull();
    expect(depois.deleted_at).not.toBeNull();
    expect(depois.anonymized_at).not.toBeNull();
    expect(depois.deletion_reason).toBe('manual');
    expect(depois.first_real_at).toEqual(anaAntes.first_real_at);
    expect(depois.last_real_at).toEqual(anaAntes.last_real_at);
    expect(await identidades(ana)).toBe(0);

    const env = (await envios(ana)).rows;
    expect(env).toHaveLength(3);
    for (const [i, e] of env.entries()) {
      expect(e.fields).toEqual({});
      expect(e.occurred_at).toEqual(antes[i]!.occurred_at);
      expect(e.page_path).toBe(antes[i]!.page_path);
      expect(e.attribution).toBe(antes[i]!.attribution);
      expect(e.is_new_lead).toBe(antes[i]!.is_new_lead);
      expect(e.attributed_event_id).toBe(antes[i]!.attributed_event_id);
    }
    expect((await admin.query('select count(*)::int as n from submissions where site_id = $1', [site1])).rows[0]!.n).toBe(totalEnvios);
    expect((await admin.query('select count(*)::int as n from submissions where site_id = $1 and is_new_lead', [site1])).rows[0]!.n).toBe(2);
    const k = (await admin.query('select resolved_at, resolution from contact_conflicts')).rows[0]!;
    expect(k.resolved_at).not.toBeNull();
    expect(k.resolution).toBe('contato_excluido');
    // Bruno não foi tocado.
    expect((await contato(bruno)).name).toBe('Bruno');
    expect(await identidades(bruno)).toBe(1);
    expect((await envios(bruno)).rows[0]!.fields).toMatchObject({ phone: '11 97777-6666' });
  });

  it('é idempotente e não revela existência: repetir → já anonimizado; id inexistente ou de outra conta → não encontrado', async () => {
    expect(await comoConta(web, A.accountId, (c) => excluirContatoNoBanco(sobre(c), { accountId: A.accountId, siteId: site1, contactId: ana, motivo: 'manual' }))).toEqual({ excluido: false, motivo: 'ja_anonimizado' });
    expect(await comoConta(web, A.accountId, (c) => excluirContatoNoBanco(sobre(c), { accountId: A.accountId, siteId: site1, contactId: randomUUID(), motivo: 'manual' }))).toEqual({ excluido: false, motivo: 'nao_encontrado' });
    // Conta B, com o id certo de Bruno: a RLS devolve "nenhuma linha"; nada muda.
    expect(await comoConta(web, B.accountId, (c) => excluirContatoNoBanco(sobre(c), { accountId: B.accountId, siteId: site1, contactId: bruno, motivo: 'manual' }))).toEqual({ excluido: false, motivo: 'nao_encontrado' });
    expect(await comoConta(web, B.accountId, (c) => excluirContatoNoBanco(sobre(c), { accountId: A.accountId, siteId: site1, contactId: bruno, motivo: 'manual' }))).toEqual({ excluido: false, motivo: 'nao_encontrado' });
    expect((await contato(bruno)).name).toBe('Bruno');
    expect(await identidades(bruno)).toBe(1);
  });

  it('some da lista e da busca por e-mail (mesma consulta da tela e do CSV); os envios continuam listados, sem campos', async () => {
    expect(await listarContatos(A.accountId, site1, { busca: 'ana@ex.com' })).toEqual([]);
    expect(await listarContatos(A.accountId, site1, { busca: 'Ana' })).toEqual([]);
    const lista = await listarContatos(A.accountId, site1);
    expect(lista.map((c) => c.id)).toEqual([bruno]);
    const subs = await listarSubmissoes(A.accountId, site1);
    expect(subs).toHaveLength(4);
    const daAna = subs.filter((s) => s.contactId === ana);
    expect(daAna).toHaveLength(3);
    for (const s of daAna) { expect(s.fields).toEqual({}); expect(s.contactName).toBeNull(); }
  });

  it('novo envio com o MESMO e-mail depois da exclusão cria contato novo, com is_new_lead', async () => {
    const antesN = (await admin.query('select count(*)::int as n from contacts')).rows[0]!.n;
    const r = await receber(PUB1, sub({ fields: { email: 'ana@ex.com', name: 'Ana de novo' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contactId).not.toBeNull();
    expect(r.contactId).not.toBe(ana);
    expect((await admin.query('select count(*)::int as n from contacts')).rows[0]!.n).toBe(antesN + 1);
    expect((await admin.query('select is_new_lead from submissions where id = $1', [r.submissionId])).rows[0]!.is_new_lead).toBe(true);
    expect(await contatoDe('email', 'ana@ex.com')).toBe(r.contactId);
    // O contato anonimizado continua anonimizado; o novo aparece na lista.
    expect((await contato(ana)).name).toBeNull();
    expect((await listarContatos(A.accountId, site1, { busca: 'ana@ex.com' })).map((c) => c.id)).toEqual([r.contactId]);
  });
});

describe('retenção automática (worker, papel app_worker)', () => {
  let velho: string; let meio: string; let recente: string;
  const diasAtras = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000);

  beforeAll(async () => {
    await receber(PUB2, sub({ fields: { name: 'Velho', email: 'velho@ex.com' } }));
    await receber(PUB2, sub({ fields: { name: 'Meio', phone: '21 99999-0000' } }));
    await receber(PUB2, sub({ fields: { name: 'Recente', email: 'recente@ex.com' } }));
    velho = await contatoDe('email', 'velho@ex.com'); meio = await contatoDe('phone', '+5521999990000'); recente = await contatoDe('email', 'recente@ex.com');
    await admin.query('update contacts set last_real_at = $2 where id = $1', [velho, diasAtras(400)]);
    await admin.query('update contacts set last_real_at = $2 where id = $1', [meio, diasAtras(40)]);
    await admin.query('update contacts set last_real_at = $2 where id = $1', [recente, diasAtras(5)]);
  });

  it('política manual (padrão): nada é anonimizado, por mais antigo que seja', async () => {
    expect(await comoConta(web, A.accountId, (c) => lerPoliticaDeRetencao(sobre(c), site2))).toEqual({ policy: 'manual', dias: null });
    expect(await aplicarRetencao(worker)).toEqual({ candidatos: 0, anonimizados: 0, erros: 0 });
    for (const id of [velho, meio, recente]) expect((await contato(id)).anonymized_at).toBeNull();
  });

  it('política de N dias: só quem passou do prazo, com motivo "retencao"; a segunda passada não encontra nada', async () => {
    await admin.query(`update site_tracking set contact_retention_policy = 'dias', contact_retention_days = 365 where site_id = $1`, [site2]);
    expect(await comoConta(web, A.accountId, (c) => lerPoliticaDeRetencao(sobre(c), site2))).toEqual({ policy: 'dias', dias: 365 });
    expect(await aplicarRetencao(worker)).toEqual({ candidatos: 1, anonimizados: 1, erros: 0 });
    const v = await contato(velho);
    expect(v.name).toBeNull(); expect(v.deletion_reason).toBe('retencao'); expect(v.anonymized_at).not.toBeNull();
    expect(await identidades(velho)).toBe(0);
    expect((await envios(velho)).rows.map((e) => e.fields)).toEqual([{}]);
    expect((await contato(meio)).name).toBe('Meio');
    expect((await contato(recente)).name).toBe('Recente');
    // Prazo menor: o de 40 dias vence; o de 5 não.
    await admin.query(`update site_tracking set contact_retention_days = 30 where site_id = $1`, [site2]);
    expect(await aplicarRetencao(worker)).toEqual({ candidatos: 1, anonimizados: 1, erros: 0 });
    expect((await contato(meio)).deletion_reason).toBe('retencao');
    expect((await contato(recente)).name).toBe('Recente');
    expect(await aplicarRetencao(worker)).toEqual({ candidatos: 0, anonimizados: 0, erros: 0 });
    // O site 1 (manual) não foi varrido: Bruno continua inteiro.
    expect((await contato(await contatoDe('phone', '+5511977776666'))).name).toBe('Bruno');
  });

  it('site arquivado continua sob a política: a retenção não depende do projeto estar ativo', async () => {
    await admin.query('update contacts set last_real_at = $2 where id = $1', [recente, diasAtras(100)]);
    await admin.query('update sites set archived_at = now() where id = $1', [site2]);
    expect(await aplicarRetencao(worker)).toEqual({ candidatos: 1, anonimizados: 1, erros: 0 });
    expect((await contato(recente)).deletion_reason).toBe('retencao');
  });

  it('o banco recusa política automática sem prazo ou com prazo fora de 30–3650; a validação da ação diz o mesmo', async () => {
    await expect(admin.query(`update site_tracking set contact_retention_policy = 'dias', contact_retention_days = null where site_id = $1`, [site1])).rejects.toThrow(/site_tracking_retention_coerente/);
    await expect(admin.query(`update site_tracking set contact_retention_policy = 'dias', contact_retention_days = 10 where site_id = $1`, [site1])).rejects.toThrow(/contact_retention_days/);
    await expect(admin.query(`update site_tracking set contact_retention_policy = 'dias', contact_retention_days = 4000 where site_id = $1`, [site1])).rejects.toThrow(/contact_retention_days/);
    expect(validarPolitica('manual', '999')).toEqual({ ok: true, valor: { policy: 'manual', dias: null } });
    expect(validarPolitica('dias', '30')).toEqual({ ok: true, valor: { policy: 'dias', dias: 30 } });
    expect(validarPolitica('dias', '3650')).toEqual({ ok: true, valor: { policy: 'dias', dias: 3650 } });
    expect(validarPolitica('dias', '29').ok).toBe(false);
    expect(validarPolitica('dias', '3651').ok).toBe(false);
    expect(validarPolitica('dias', '').ok).toBe(false);
    expect(validarPolitica('dias', '90.5').ok).toBe(false);
    expect(validarPolitica('apagar_tudo', '90').ok).toBe(false);
  });
});
