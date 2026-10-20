import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { createHmac, randomBytes } from 'node:crypto';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';
import { ingerirLote, siteDoPublicId } from '@/modules/analytics/ingestao';
import { confirmarPeloDestino, hashDoSegredo, receberSubmissao, siteDeFormulario } from '@/modules/contacts/recepcao';
import type { Queryable } from '@/shared/db';

function wrap(pool: Pool) {
  return async <T,>(fn: (db: Queryable) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    const q: Queryable = { query: async (s, p = []) => (await c.query(s, p)).rows, one: async (s, p = []) => (await c.query(s, p)).rows[0] ?? null };
    try { await c.query('begin'); const r = await fn(q); await c.query('commit'); return r; } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  };
}
const poolDe = (env: string) => { const u = new URL(process.env[env]!); u.pathname = `/${BANCO_TESTE}`; return new Pool({ connectionString: u.toString(), max: 6 }); };

let admin: Client; let web: Pool; let ingest: Pool; let forms: Pool;
let comIngest: ReturnType<typeof wrap>; let comForms: ReturnType<typeof wrap>;
let conta: { accountId: string; userId: string }; let siteId: string;
const PUB = 'pub-ingest-1';
const agora = new Date();
const seg = (s: number) => new Date(agora.getTime() - s * 1000).toISOString();
const ev = (o: Record<string, unknown>) => ({ event_id: 'e' + randomBytes(6).toString('hex'), session_key: 'sess-' + randomBytes(5).toString('hex'), type: 'page_view', path: '/', occurred_at: seg(5), ...o });
const sub = (o: Record<string, unknown>) => ({ submission_id: 'sub-' + randomBytes(6).toString('hex'), fields: { name: 'Ana', email: 'ana@ex.com' }, ...o });

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  ingest = poolDe('DATABASE_URL_INGEST'); forms = poolDe('DATABASE_URL_FORMS');
  comIngest = wrap(ingest); comForms = wrap(forms);
  conta = await criarConta(admin, 'Conta Ingest');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const s = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone) values ($1, $2, 'S', 'ex.com', 'https://ex.com/', $3, 'America/Sao_Paulo') returning id`, [conta.accountId, c.rows[0]!.id, PUB]);
  siteId = s.rows[0]!.id;
  await admin.query(`insert into site_tracking (site_id, account_id, webhook_secret_hash) values ($1, $2, $3)`, [siteId, conta.accountId, hashDoSegredo('segredo-teste')]);
  await admin.query(`insert into diagnostic_sessions (account_id, site_id, token, expires_at) values ($1, $2, 'diag-token-123', now() + interval '1 hour')`, [conta.accountId, siteId]);
});
afterAll(async () => { await ingest.end(); await forms.end(); await web.end(); await admin.end(); });

const ingerir = (lote: unknown[]) => comIngest(async (db) => ingerirLote(db, (await siteDoPublicId(db, PUB))!, lote, new Date()));
const receber = (e: Parameters<typeof receberSubmissao>[2], modo: 'endpoint' | 'auxiliar' = 'endpoint') => comForms(async (db) => receberSubmissao(db, (await siteDeFormulario(db, PUB))!, e, modo, new Date()));

describe('eventos', () => {
  it('E01: mesmo event_id reenviado → um evento, nenhuma sessão adicional', async () => {
    const e = ev({});
    expect(await ingerir([e])).toMatchObject({ aceitos: 1, duplicados: 0 });
    expect(await ingerir([e, e])).toMatchObject({ aceitos: 0, duplicados: 2 });
    expect((await admin.query('select count(*)::int as n from events where event_id = $1', [e.event_id])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from sessions where session_key = $1', [e.session_key])).rows[0].n).toBe(1);
  });
  it('E02: dois eventos simultâneos do mesmo visitante → uma sessão, dois eventos', async () => {
    const key = 'sess-' + randomBytes(5).toString('hex');
    const [a, b] = await Promise.all([ingerir([ev({ session_key: key })]), ingerir([ev({ session_key: key, type: 'click', action_kind: 'whatsapp', button_id: 'w' })])]);
    expect(a.aceitos + b.aceitos).toBe(2);
    expect((await admin.query('select count(*)::int as n from sessions where session_key = $1', [key])).rows[0].n).toBe(1);
  });
  it('E03: evento atrasado depois da sessão expirar não estende a janela', async () => {
    const key = 'sess-' + randomBytes(5).toString('hex');
    await ingerir([ev({ session_key: key, occurred_at: seg(3500) })]);
    const antes = (await admin.query('select last_seen_at from sessions where session_key = $1', [key])).rows[0].last_seen_at;
    await ingerir([ev({ session_key: key, occurred_at: seg(10) })]); // 58 min depois: sessão já expirada
    const depois = (await admin.query('select last_seen_at from sessions where session_key = $1', [key])).rows[0].last_seen_at;
    expect(new Date(depois).getTime()).toBe(new Date(antes).getTime());
    expect((await admin.query('select count(*)::int as n from events where session_id = (select id from sessions where session_key = $1)', [key])).rows[0].n).toBe(2);
  });
  it('E04: path normalizado (sem query) e evento inválido rejeitado sem derrubar o lote', async () => {
    const r = await ingerir([ev({ path: '/landing/?utm_source=x#topo' }), { event_id: 'curto', type: 'page_view' }]);
    expect(r).toMatchObject({ aceitos: 1 });
    expect(r.rejeitados).toHaveLength(1);
    expect((await admin.query("select count(*)::int as n from events where path = '/landing'")).rows[0].n).toBe(1);
  });
  it('F04/diagnóstico: evento com token válido é is_test e registra evidência; token inválido é evento real', async () => {
    await ingerir([ev({ test_token: 'diag-token-123', type: 'click', action_kind: 'phone', button_id: 'auto-phone' })]);
    await ingerir([ev({ test_token: 'token-falso-1234' })]);
    expect((await admin.query('select count(*)::int as n from events where is_test')).rows[0].n).toBe(1);
    const d = await admin.query("select evidence from diagnostic_sessions where token = 'diag-token-123'");
    expect(d.rows[0].evidence.click).toBeDefined();
  });
});

describe('formulários e contatos', () => {
  it('F01: reenvio da mesma submissão → mesmo resultado lógico, um registro, um contato', async () => {
    const s = sub({});
    const r1 = await receber(s);
    const r2 = await receber(s);
    expect(r1.ok && !r1.duplicado).toBe(true);
    expect(r2.ok && r2.duplicado && r2.submissionId === (r1.ok ? r1.submissionId : '')).toBe(true);
    expect((await admin.query('select count(*)::int as n from submissions where submission_id = $1', [s.submission_id])).rows[0].n).toBe(1);
    expect((await admin.query("select count(*)::int as n from contacts")).rows[0].n).toBe(1);
    expect((await admin.query('select is_new_lead from submissions where submission_id = $1', [s.submission_id])).rows[0].is_new_lead).toBe(true);
  });
  it('mesmo e-mail de novo: contato existente, não é novo lead; sem contato válido é rejeitado', async () => {
    const r = await receber(sub({ fields: { email: 'ANA@ex.com', name: 'Ana P.' } }));
    expect(r.ok && r.contactId).toBeTruthy();
    expect((await admin.query('select count(*)::int as n from contacts')).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from submissions where is_new_lead')).rows[0].n).toBe(1);
    const ruim = await receber(sub({ fields: { name: 'Só nome' } }));
    expect(ruim.ok).toBe(false);
  });
  it('F02: modo auxiliar com destino falho fica falha_destino; sem informação fica recebido; nunca confirmado', async () => {
    const a = await receber(sub({ fields: { phone: '11 98888-7777' }, destination_status: 'failed' }), 'auxiliar');
    const b = await receber(sub({ fields: { phone: '11 98888-7777' } }), 'auxiliar');
    expect(a.ok && a.status).toBe('falha_destino');
    expect(b.ok && b.status).toBe('recebido');
    expect((await admin.query("select count(*)::int as n from submissions where receipt_status = 'confirmado_destino'")).rows[0].n).toBe(0);
  });
  it('F03: e-mail de A com telefone de B → conflito registrado, nada mesclado', async () => {
    // A = ana@ex.com (contato 1); B = +5511988887777 (contato 2, criado acima).
    const r = await receber(sub({ fields: { email: 'ana@ex.com', phone: '(11) 98888-7777' } }));
    expect(r.ok).toBe(true);
    const conf = await admin.query('select * from contact_conflicts');
    expect(conf.rowCount).toBe(1);
    expect(conf.rows[0].email_contact_id).not.toBe(conf.rows[0].phone_contact_id);
    expect((await admin.query('select count(*)::int as n from contacts')).rows[0].n).toBe(2);
  });
  it('T02/T03: submissão com clique na sessão em até 30 min → atribuída ao último; sem clique → sem atribuição; clique sozinho não cria lead', async () => {
    const key = 'sess-' + randomBytes(5).toString('hex');
    await ingerir([ev({ session_key: key, type: 'click', action_kind: 'whatsapp', button_id: 'wpp-topo', occurred_at: seg(600) }), ev({ session_key: key, type: 'click', action_kind: 'form', button_id: 'abrir-form', occurred_at: seg(120) })]);
    const contatosAntes = (await admin.query('select count(*)::int as n from contacts')).rows[0].n;
    const r = await receber(sub({ fields: { email: 'novo@ex.com' }, session_key: key }));
    expect(r.ok && r.attribution).toBe('ultimo_clique');
    const s = await admin.query('select e.button_id from submissions s join events e on e.id = s.attributed_event_id where s.submission_id = $1', [r.ok ? '' : '']).catch(() => null);
    const atrib = await admin.query("select e.button_id from submissions s join events e on e.id = s.attributed_event_id where s.contact_id in (select contact_id from contact_identities where value = 'novo@ex.com')");
    expect(atrib.rows[0].button_id).toBe('abrir-form');
    void s;
    const r2 = await receber(sub({ fields: { email: 'outro@ex.com' }, session_key: 'sess-' + randomBytes(5).toString('hex') }));
    expect(r2.ok && r2.attribution).toBe('sem_atribuicao');
    // Clique sem submissão não criou contato além dos esperados.
    expect((await admin.query('select count(*)::int as n from contacts')).rows[0].n).toBe(contatosAntes + 2);
  });
  it('F04: submissão de diagnóstico não cria contato nem lead, mesmo com e-mail real existente', async () => {
    const antes = (await admin.query('select count(*)::int as n, max(last_real_at) as u from contacts')).rows[0];
    const r = await receber(sub({ fields: { email: 'ana@ex.com' }, test_token: 'diag-token-123' }));
    expect(r.ok && r.contactId).toBeNull();
    const depois = (await admin.query('select count(*)::int as n, max(last_real_at) as u from contacts')).rows[0];
    expect(depois).toEqual(antes);
    expect((await admin.query('select is_test, is_new_lead from submissions where submission_id = $1', [r.ok ? (await admin.query('select submission_id from submissions where id = $1', [r.submissionId])).rows[0].submission_id : ''])).rows[0]).toEqual({ is_test: true, is_new_lead: false });
  });
});

describe('webhook assinado', () => {
  const corpo = JSON.stringify(sub({ fields: { email: 'crm@ex.com' } }));
  const cab = (ts: string, nonce: string, segredo = 'segredo-teste') => ({ timestamp: ts, nonce, assinatura: createHmac('sha256', segredo).update(`${ts}.${nonce}.${corpo}`).digest('hex') });
  const ts = () => String(Math.floor(Date.now() / 1000));
  it('assinatura válida confirma no destino; replay do nonce é recusado; assinatura errada e timestamp velho também', async () => {
    const ok = await comForms(async (db) => confirmarPeloDestino(db, (await siteDeFormulario(db, PUB))!, 'segredo-teste', cab(ts(), 'n1'), corpo, new Date()));
    expect(ok.ok).toBe(true);
    expect((await admin.query("select receipt_status, mode from submissions where fields->>'email' = 'crm@ex.com'")).rows[0]).toEqual({ receipt_status: 'confirmado_destino', mode: 'webhook' });
    const replay = await comForms(async (db) => confirmarPeloDestino(db, (await siteDeFormulario(db, PUB))!, 'segredo-teste', cab(ts(), 'n1'), corpo, new Date()));
    expect(replay.ok === false && replay.codigo).toBe(409);
    const errada = await comForms(async (db) => confirmarPeloDestino(db, (await siteDeFormulario(db, PUB))!, 'segredo-teste', cab(ts(), 'n2', 'outro'), corpo, new Date()));
    expect(errada.ok === false && errada.codigo).toBe(401);
    const velha = await comForms(async (db) => confirmarPeloDestino(db, (await siteDeFormulario(db, PUB))!, 'segredo-teste', cab(String(Math.floor(Date.now() / 1000) - 1000), 'n3'), corpo, new Date()));
    expect(velha.ok === false && velha.codigo).toBe(401);
  });
});

describe('privilégios dos papéis públicos', () => {
  it('app_ingest não lê contatos nem usuários; app_forms não lê usuários nem incidentes; a central lê tudo da conta', async () => {
    await expect(ingest.query('select * from contacts')).rejects.toThrow(/permission denied/);
    await expect(ingest.query('select * from users')).rejects.toThrow(/permission denied/);
    await expect(forms.query('select * from users')).rejects.toThrow(/permission denied/);
    await expect(forms.query('select * from incidents')).rejects.toThrow(/permission denied/);
    const n = await comoConta(web, conta.accountId, (c) => c.query('select count(*)::int as n from submissions'));
    expect(n.rows[0].n).toBeGreaterThan(0);
  });
});
