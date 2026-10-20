import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, criarConta, prepararBanco, urls } from './apoio';
import { botoes } from '@/modules/analytics/consultas';
import { hashDoSegredo, receberSubmissao, siteDeFormulario } from '@/modules/contacts/recepcao';
import type { Queryable } from '@/shared/db';

/**
 * Regressões da estabilização. O achado 1 (cliques inflados pelo join) passa pela
 * mesma `botoes()` que a tela usa; o achado 2 (concorrência na recepção) usa
 * conexões distintas e uma BARREIRA que força as duas transações a chegarem
 * juntas à busca de identidade — sem as travas, as duas criam contato.
 */
let admin: Client; let forms: Pool;
let conta: { accountId: string; userId: string }; let siteId: string;
const PUB = 'pub-estab-1';

const poolDe = (env: string) => { const u = new URL(process.env[env]!); u.pathname = `/${BANCO_TESTE}`; return new Pool({ connectionString: u.toString(), max: 6 }); };

/** Barreira com limite: espera os dois chegarem OU `ms` passarem (se um estiver travado por lock, o outro segue). */
function barreira(n: number, ms: number) {
  let chegaram = 0;
  let liberar!: () => void;
  const livre = new Promise<void>((r) => { liberar = r; });
  return async () => {
    chegaram += 1;
    if (chegaram >= n) liberar();
    await Promise.race([livre, new Promise((r) => setTimeout(r, ms))]);
  };
}

async function comFormsSincronizado<T>(esperar: () => Promise<void>, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const c = await forms.connect();
  let jaEsperou = false;
  const q: Queryable = {
    query: async (s, p = []) => (await c.query(s, p)).rows,
    one: async (s, p = []) => {
      // Ponto da disputa: a busca de identidade existente, antes de criar o contato.
      if (!jaEsperou && /from contact_identities where site_id = \$1 and kind = \$2/.test(s)) { jaEsperou = true; await esperar(); }
      return (await c.query(s, p)).rows[0] ?? null;
    },
  };
  try { await c.query('begin'); const r = await fn(q); await c.query('commit'); return r; } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

const limparContatos = async () => {
  await admin.query('delete from submissions where site_id = $1', [siteId]);
  await admin.query('delete from contact_conflicts where site_id = $1', [siteId]);
  await admin.query('delete from contacts where site_id = $1', [siteId]);
};

beforeAll(async () => {
  await prepararBanco();
  admin = new Client({ connectionString: urls().admin }); await admin.connect();
  forms = poolDe('DATABASE_URL_FORMS');
  conta = await criarConta(admin, 'Conta Estab');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const s = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone) values ($1, $2, 'S', 'ex.com', 'https://ex.com/', $3, 'America/Sao_Paulo') returning id`, [conta.accountId, c.rows[0]!.id, PUB]);
  siteId = s.rows[0]!.id;
  await admin.query(`insert into site_tracking (site_id, account_id, webhook_secret_hash) values ($1, $2, $3)`, [siteId, conta.accountId, hashDoSegredo('x')]);
});
afterAll(async () => { await forms.end(); await admin.end(); });

describe('achado 1 — cliques por botão não são multiplicados por submissões', () => {
  it('1 clique com 3 submissões atribuídas → 1 clique, 1 sessão com clique, 3 contatos, 1 sessão convertida', async () => {
    const agora = new Date();
    const sess = await admin.query<{ id: string }>(`insert into sessions (account_id, site_id, session_key, started_at, last_seen_at) values ($1, $2, 'sess-botao-1', $3, $3) returning id`, [conta.accountId, siteId, agora]);
    const ev = await admin.query<{ id: string }>(
      `insert into events (account_id, site_id, event_id, session_id, type, path, button_id, button_pos, action_kind, occurred_at) values ($1, $2, 'ev-botao-1', $3, 'click', '/contato', 'cta', 'topo', 'form', $4) returning id`,
      [conta.accountId, siteId, sess.rows[0]!.id, new Date(agora.getTime() - 60_000)],
    );
    for (const i of [1, 2, 3]) {
      await admin.query(
        `insert into submissions (account_id, site_id, submission_id, mode, receipt_status, evidence_source, session_id, attributed_event_id, attribution, occurred_at)
         values ($1, $2, $3, 'endpoint', 'recebido', 't', $4, $5, 'ultimo_clique', $6)`,
        [conta.accountId, siteId, `sub-botao-${i}`, sess.rows[0]!.id, ev.rows[0]!.id, agora],
      );
    }
    const linhas = await botoesComBanco();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ buttonId: 'cta', path: '/contato', pos: 'topo', cliques: 1, sessoesComClique: 1, contatosAtribuidos: 3, sessoesConvertidas: 1 });
  });
});

/** `botoes()` usa a conexão da central; aqui a mesma consulta roda como `app_web` no banco de teste. */
async function botoesComBanco() {
  const u = urls();
  process.env.DATABASE_URL = u.web;
  delete (globalThis as { __johnyPools?: unknown }).__johnyPools;
  return botoes(conta.accountId, siteId, { dias: 1, de: new Date(Date.now() - 3600_000 * 24), ate: new Date(Date.now() + 3600_000) });
}

describe('achado 2 — recepção atômica sob concorrência', () => {
  const receber = (esperar: () => Promise<void>, e: Parameters<typeof receberSubmissao>[2]) =>
    comFormsSincronizado(esperar, async (db) => receberSubmissao(db, (await siteDeFormulario(db, PUB))!, e, 'endpoint', new Date()));

  it('A) duas submissões diferentes, mesmo e-mail, ao mesmo tempo → 1 contato, 1 identidade, 2 submissões, 1 novo lead', async () => {
    await limparContatos(); await admin.query('delete from contact_identities where site_id = $1', [siteId]);
    const b = barreira(2, 400);
    const campos = { name: 'Ana', email: 'Ana@Ex.com' };
    const [r1, r2] = await Promise.all([
      receber(b, { submission_id: 'conc-a-0001', fields: campos }),
      receber(b, { submission_id: 'conc-a-0002', fields: { ...campos, email: 'ana@ex.com' } }),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    expect((await admin.query('select count(*)::int as n from contacts where site_id = $1', [siteId])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from contact_identities where site_id = $1', [siteId])).rows[0].n).toBe(1);
    const subs = await admin.query('select contact_id, is_new_lead from submissions where site_id = $1', [siteId]);
    expect(subs.rowCount).toBe(2);
    expect(new Set(subs.rows.map((x) => x.contact_id)).size).toBe(1);
    expect(subs.rows.filter((x) => x.is_new_lead)).toHaveLength(1);
  });

  it('B) mesmo submission_id ao mesmo tempo → 1 submissão, 1 contato, nenhum excedente; o reenvio é duplicado', async () => {
    await limparContatos(); await admin.query('delete from contact_identities where site_id = $1', [siteId]);
    const b = barreira(2, 400);
    const e = { submission_id: 'conc-b-0001', fields: { name: 'Bia', email: 'bia@ex.com' } };
    const [r1, r2] = await Promise.all([receber(b, e), receber(b, e)]);
    if (!r1.ok || !r2.ok) throw new Error('esperava sucesso nas duas');
    expect([r1.duplicado, r2.duplicado].sort()).toEqual([false, true]);
    expect(r1.submissionId).toBe(r2.submissionId);
    expect(r1.contactId).toBe(r2.contactId);
    expect((await admin.query('select count(*)::int as n from submissions where site_id = $1', [siteId])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int as n from contacts where site_id = $1', [siteId])).rows[0].n).toBe(1);
  });
});
