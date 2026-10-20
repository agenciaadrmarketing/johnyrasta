import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';

/**
 * Auditoria final de permissões, contra um banco recém-migrado.
 *
 * A ideia é que a matriz abaixo seja a ÚNICA fonte declarada: qualquer grant,
 * coluna, sequência, função ou tabela nova que não esteja aqui faz o teste
 * falhar, e quem adicionou precisa vir aqui dizer, por escrito, o que o papel
 * passa a poder fazer.
 *
 *   TEST_DB_NAME=johnyweb_test_perm npx vitest run tests/integration/permissoes.spec.ts
 */

type Papel = 'app_web' | 'app_worker' | 'app_ingest' | 'app_forms';
const PAPEIS: Papel[] = ['app_web', 'app_worker', 'app_ingest', 'app_forms'];
type Priv = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
const S: Priv[] = ['SELECT'];
const SI: Priv[] = ['SELECT', 'INSERT'];
const SU: Priv[] = ['SELECT', 'UPDATE'];
const SD: Priv[] = ['SELECT', 'DELETE'];
const SIU: Priv[] = ['SELECT', 'INSERT', 'UPDATE'];
const SID: Priv[] = ['SELECT', 'INSERT', 'DELETE'];
const SIUD: Priv[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** Grants de TABELA (inteira) por papel. Tabela sem papel = nenhum papel de aplicação a toca. */
const MATRIZ: Record<string, Partial<Record<Papel, Priv[]>>> = {
  // 0001/0002 — fundação
  accounts: { app_web: S },
  users: { app_web: S },
  auth_sessions: {}, // só por funções SECURITY DEFINER
  password_resets: { app_worker: SD }, // web só por funções SECURITY DEFINER; worker apaga vencidos
  clients: { app_web: SIUD },
  sites: { app_web: SIUD, app_worker: S, app_ingest: S, app_forms: S },
  site_favorites: { app_web: SIUD },
  monitors: { app_web: SIUD, app_worker: SU },
  worker_heartbeats: { app_web: S, app_worker: SIU },
  audit_log: { app_web: SI },
  // 0003 — disponibilidade
  checks: { app_web: S, app_worker: SID },
  incidents: { app_web: S, app_worker: SIU },
  alerts: { app_web: SU, app_worker: SIU },
  // 0004 — velocidade
  monitored_urls: { app_web: SIUD, app_worker: S },
  audit_jobs: { app_web: SIU, app_worker: SIU },
  performance_runs: { app_web: S, app_worker: SID },
  crux_snapshots: { app_web: S, app_worker: SI },
  // 0005 — eventos e contatos (+ 0007: worker lê site_tracking e conflitos; web apaga identidades)
  site_tracking: { app_web: SIU, app_worker: S, app_ingest: S, app_forms: S },
  sessions: { app_web: S, app_worker: SD, app_ingest: SIU, app_forms: SIU },
  events: { app_web: S, app_worker: SD, app_ingest: SI, app_forms: S },
  contacts: { app_web: SU, app_forms: SIU }, // app_worker: só colunas (abaixo)
  contact_identities: { app_web: SD, app_worker: ['DELETE'], app_forms: SIU },
  submissions: { app_web: S, app_forms: SIU }, // app_worker: só colunas (0008)
  contact_conflicts: { app_web: SU, app_worker: S, app_forms: SIU },
  webhook_nonces: { app_forms: SID },
  diagnostic_sessions: { app_web: SIU, app_ingest: SU, app_forms: SU },
  // controle das migrações: só o administrador
  schema_migrations: {},
};

/** Grants POR COLUNA (0007). O que não está aqui, o papel não enxerga nem altera nessa coluna. */
const COLUNAS: Record<string, Partial<Record<Papel, Partial<Record<Priv, string[]>>>>> = {
  contacts: {
    app_worker: {
      SELECT: ['id', 'account_id', 'site_id', 'first_real_at', 'last_real_at', 'created_at', 'deleted_at', 'anonymized_at', 'deletion_reason'],
      UPDATE: ['name', 'deleted_at', 'anonymized_at', 'deletion_reason'],
    },
  },
  contact_identities: {
    app_worker: { SELECT: ['id', 'account_id', 'site_id', 'contact_id', 'kind', 'created_at'] },
    app_web: { UPDATE: ['contact_id'] },
  },
  submissions: {
    app_worker: { SELECT: ['id', 'account_id', 'site_id', 'contact_id', 'session_id'], UPDATE: ['fields'] },
    app_web: { UPDATE: ['contact_id', 'fields'] },
  },
  contact_conflicts: {
    app_worker: { UPDATE: ['resolved_at', 'resolution'] },
  },
};

/**
 * Tabelas de OUTRA frente (0006, notificações), declaradas a partir do banco
 * de desenvolvimento em 20/10/2026. Só são conferidas se existirem; depois do
 * merge, a divergência aparece aqui e quem fez a migração ajusta a matriz.
 */
const OUTRAS_FRENTES: Record<string, Partial<Record<Papel, Priv[]>>> = {
  alert_deliveries: { app_web: S, app_worker: SIU },
  notification_settings: { app_web: SIU, app_worker: S },
  site_notification_prefs: { app_web: SIU, app_worker: S },
};

const SEQUENCIAS: Record<string, Partial<Record<Papel, string[]>>> = {
  audit_log_id_seq: { app_web: ['USAGE'] },
  checks_id_seq: { app_worker: ['USAGE'] },
  events_id_seq: { app_ingest: ['USAGE'] },
};

/** Funções SECURITY DEFINER do schema app: só a central executa; PUBLIC nunca. */
const FUNCOES_DEFINER = ['consume_password_reset', 'create_session', 'find_user_for_login', 'find_user_for_session', 'list_sessions', 'password_hash_of', 'password_reset_valid', 'request_password_reset', 'revoke_other_sessions', 'revoke_session', 'update_password', 'update_profile'];
const FUNCOES_COMUNS = ['current_account_id', 'touch_updated_at'];

/** Tabelas sem RLS, com o motivo. Qualquer outra sem RLS forçada reprova. */
const SEM_RLS: Record<string, string> = { schema_migrations: 'controle das migrações; nenhum papel de aplicação tem grant' };

const poolDe = (env: string) => { const u = new URL(process.env[env]!); u.pathname = `/${BANCO_TESTE}`; return new Pool({ connectionString: u.toString(), max: 2 }); };
const ordenar = (a: string[]) => [...a].sort();

let admin: Client; let web: Pool; let worker: Pool; let ingest: Pool; let forms: Pool;
let tabelas: string[];
const existe = (t: string) => tabelas.includes(t);
const esperadoDe = (t: string): Partial<Record<Papel, Priv[]>> => MATRIZ[t] ?? OUTRAS_FRENTES[t] ?? {};

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin }); await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  worker = poolDe('DATABASE_URL_WORKER'); ingest = poolDe('DATABASE_URL_INGEST'); forms = poolDe('DATABASE_URL_FORMS');
  tabelas = (await admin.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.t);
});
afterAll(async () => { await web.end(); await worker.end(); await ingest.end(); await forms.end(); await admin.end(); });

describe('a) matriz de grants por papel × tabela', () => {
  it('toda tabela do schema public está declarada na matriz', () => {
    const declaradas = new Set([...Object.keys(MATRIZ), ...Object.keys(OUTRAS_FRENTES)]);
    expect(tabelas.filter((t) => !declaradas.has(t)), 'tabelas novas sem linha na matriz').toEqual([]);
    const outras = Object.keys(OUTRAS_FRENTES).filter(existe);
    if (outras.length) console.log(`[permissões] tabelas de outra frente presentes e conferidas: ${outras.join(', ')}`);
  });

  it('os grants de tabela são EXATAMENTE os declarados (information_schema.role_table_grants), sem PUBLIC', async () => {
    const grants = await admin.query<{ t: string; papel: string; priv: string }>(
      `select table_name as t, grantee as papel, privilege_type as priv
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee <> grantor`,
    );
    const real: Record<string, Record<string, string[]>> = {};
    for (const g of grants.rows) ((real[g.t] ??= {})[g.papel] ??= []).push(g.priv);
    const diffs: string[] = [];
    for (const t of tabelas) {
      const esperado = esperadoDe(t);
      const papeis = new Set([...Object.keys(esperado), ...Object.keys(real[t] ?? {})]);
      for (const p of papeis) {
        const e = ordenar(esperado[p as Papel] ?? []);
        const r = ordenar(real[t]?.[p] ?? []);
        if (!PAPEIS.includes(p as Papel)) diffs.push(`${t} · ${p}: grant para papel fora da aplicação [${r.join(',')}]`);
        else if (e.join(',') !== r.join(',')) diffs.push(`${t} · ${p}: esperado [${e.join(',')}] · real [${r.join(',')}]`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('os grants por coluna são EXATAMENTE os declarados (pg_attribute.attacl)', async () => {
    const cols = await admin.query<{ t: string; coluna: string; papel: string; priv: string }>(
      `select c.relname as t, a.attname as coluna, x.grantee::regrole::text as papel, x.privilege_type as priv
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         cross join lateral aclexplode(a.attacl) x
        where c.relnamespace = 'public'::regnamespace and a.attacl is not null`,
    );
    const real: Record<string, Record<string, Record<string, string[]>>> = {};
    for (const g of cols.rows) (((real[g.t] ??= {})[g.papel] ??= {})[g.priv] ??= []).push(g.coluna);
    const diffs: string[] = [];
    const ts = new Set([...Object.keys(COLUNAS), ...Object.keys(real)]);
    for (const t of ts) {
      const papeis = new Set([...Object.keys(COLUNAS[t] ?? {}), ...Object.keys(real[t] ?? {})]);
      for (const p of papeis) {
        const privs = new Set([...Object.keys(COLUNAS[t]?.[p as Papel] ?? {}), ...Object.keys(real[t]?.[p] ?? {})]);
        for (const priv of privs) {
          const e = ordenar(COLUNAS[t]?.[p as Papel]?.[priv as Priv] ?? []);
          const r = ordenar(real[t]?.[p]?.[priv] ?? []);
          if (e.join(',') !== r.join(',')) diffs.push(`${t} · ${p} · ${priv}: esperado [${e.join(',')}] · real [${r.join(',')}]`);
        }
      }
    }
    expect(diffs).toEqual([]);
  });

  it('sequências: só as três declaradas, cada uma para um papel', async () => {
    const r = await admin.query<{ s: string; papel: string; priv: string }>(
      `select object_name as s, grantee as papel, privilege_type as priv from information_schema.role_usage_grants
        where object_schema = 'public' and object_type = 'SEQUENCE' and grantee <> grantor`,
    );
    const real: Record<string, Record<string, string[]>> = {};
    for (const g of r.rows) ((real[g.s] ??= {})[g.papel] ??= []).push(g.priv);
    expect(real).toEqual(SEQUENCIAS);
  });

  it('schemas: USAGE em public e app para os quatro papéis; CREATE para nenhum; papéis sem superpoderes nem bypass de RLS', async () => {
    for (const p of PAPEIS) {
      for (const schema of ['public', 'app']) {
        expect((await admin.query('select has_schema_privilege($1, $2, $3) as ok', [p, schema, 'USAGE'])).rows[0]!.ok, `${p} USAGE ${schema}`).toBe(true);
        expect((await admin.query('select has_schema_privilege($1, $2, $3) as ok', [p, schema, 'CREATE'])).rows[0]!.ok, `${p} CREATE ${schema}`).toBe(false);
      }
    }
    const roles = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; membros: number }>(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              (select count(*)::int from pg_auth_members m where m.member = r.oid) as membros
         from pg_roles r where rolname = any($1) order by 1`,
      [PAPEIS],
    );
    expect(roles.rows.map((r) => r.rolname)).toEqual(ordenar(PAPEIS));
    for (const r of roles.rows) expect(r, r.rolname).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, membros: 0 });
  });

  it('todo grant tem política correspondente (um grant sem política é acesso morto, e um sinal de esquecimento)', async () => {
    const pol = await admin.query<{ t: string; roles: string[] }>("select tablename as t, roles::text[] as roles from pg_policies where schemaname = 'public'");
    const faltam: string[] = [];
    for (const t of tabelas) {
      if (SEM_RLS[t]) continue;
      const papeis = new Set<string>([...Object.keys(esperadoDe(t)), ...Object.keys(COLUNAS[t] ?? {})]);
      for (const p of papeis) {
        const privs = esperadoDe(t)[p as Papel] ?? [];
        const cols = COLUNAS[t]?.[p as Papel] ?? {};
        if (!privs.length && !Object.keys(cols).length) continue;
        if (!pol.rows.some((x) => x.t === t && (x.roles.includes(p) || x.roles.includes('public')))) faltam.push(`${t} · ${p}`);
      }
    }
    expect(faltam).toEqual([]);
  });
});

describe('b) conta B não enxerga linha de A em nenhuma tabela com account_id', () => {
  const COM_ACCOUNT_ID = [
    'users', 'auth_sessions', 'clients', 'sites', 'site_favorites', 'monitors', 'audit_log',
    'checks', 'incidents', 'alerts', 'monitored_urls', 'audit_jobs', 'performance_runs', 'crux_snapshots',
    'site_tracking', 'sessions', 'events', 'contacts', 'contact_identities', 'submissions', 'contact_conflicts', 'diagnostic_sessions',
  ];
  const COM_ACCOUNT_ID_OUTRAS = ['alert_deliveries', 'notification_settings', 'site_notification_prefs'];
  let A: { accountId: string; userId: string }; let B: { accountId: string; userId: string };
  let comAccount: string[];

  beforeAll(async () => {
    comAccount = (await admin.query<{ t: string }>("select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'account_id' order by 1")).rows.map((r) => r.t);
    A = await criarConta(admin, 'Conta A'); B = await criarConta(admin, 'Conta B');
    const q = async (sql: string, params: unknown[] = []) => (await admin.query<{ id: string }>(sql, params)).rows[0]?.id as string;
    const a = A.accountId;
    const cliente = await q('insert into clients (account_id, name) values ($1, $2) returning id', [a, 'Cliente A']);
    const site = await q(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Site A', 'a.exemplo.com', 'https://a.exemplo.com/', 'pub-perm-a') returning id`, [a, cliente]);
    const monitor = await q('insert into monitors (account_id, site_id, url) values ($1, $2, $3) returning id', [a, site, 'https://a.exemplo.com/']);
    await admin.query("insert into auth_sessions (user_id, account_id, token_hash, expires_at) values ($1, $2, repeat('a', 64), now() + interval '1 hour')", [A.userId, a]);
    await admin.query('insert into site_favorites (account_id, user_id, site_id) values ($1, $2, $3)', [a, A.userId, site]);
    await admin.query("insert into audit_log (account_id, user_id, action, target_type) values ($1, $2, 'teste', 'site')", [a, A.userId]);
    await admin.query('insert into checks (account_id, monitor_id, site_id, ok) values ($1, $2, $3, true)', [a, monitor, site]);
    await admin.query('insert into incidents (account_id, monitor_id, site_id, first_failure_at) values ($1, $2, $3, now())', [a, monitor, site]);
    const alerta = await q(`insert into alerts (account_id, site_id, kind, severity, dedupe_key, title) values ($1, $2, 'incidente_confirmado', 'alta', 'k:a', 'alerta de A') returning id`, [a, site]);
    const url = await q('insert into monitored_urls (account_id, site_id, url) values ($1, $2, $3) returning id', [a, site, 'https://a.exemplo.com/']);
    await admin.query(`insert into audit_jobs (account_id, site_id, kind, dedupe_key) values ($1, $2, 'pagespeed', 'job:a')`, [a, site]);
    await admin.query(`insert into performance_runs (account_id, site_id, monitored_url_id, url, device, status) values ($1, $2, $3, 'https://a.exemplo.com/', 'mobile', 'ok')`, [a, site, url]);
    await admin.query(`insert into crux_snapshots (account_id, site_id, scope, identifier, device) values ($1, $2, 'url', 'https://a.exemplo.com/', 'mobile')`, [a, site]);
    await admin.query('insert into site_tracking (site_id, account_id) values ($1, $2)', [site, a]);
    const sessao = await q('insert into sessions (account_id, site_id, session_key, started_at, last_seen_at) values ($1, $2, $3, now(), now()) returning id', [a, site, 'sess-a']);
    await admin.query(`insert into events (account_id, site_id, event_id, session_id, type, path, occurred_at) values ($1, $2, 'ev-a', $3, 'page_view', '/', now())`, [a, site, sessao]);
    const c1 = await q('insert into contacts (account_id, site_id, name) values ($1, $2, $3) returning id', [a, site, 'Pessoa A1']);
    const c2 = await q('insert into contacts (account_id, site_id, name) values ($1, $2, $3) returning id', [a, site, 'Pessoa A2']);
    await admin.query(`insert into contact_identities (account_id, site_id, contact_id, kind, value) values ($1, $2, $3, 'email', 'a1@exemplo.com')`, [a, site, c1]);
    const sub = await q(`insert into submissions (account_id, site_id, submission_id, mode, receipt_status, evidence_source, contact_id, fields, occurred_at) values ($1, $2, 'sub-a', 'endpoint', 'recebido', 'teste', $3, '{"email":"a1@exemplo.com"}', now()) returning id`, [a, site, c1]);
    await admin.query('insert into contact_conflicts (account_id, site_id, submission_id, email_contact_id, phone_contact_id) values ($1, $2, $3, $4, $5)', [a, site, sub, c1, c2]);
    await admin.query(`insert into diagnostic_sessions (account_id, site_id, token, expires_at) values ($1, $2, 'diag-a', now() + interval '1 hour')`, [a, site]);
    if (existe('alert_deliveries')) await admin.query(`insert into alert_deliveries (account_id, alert_id, channel, recipient) values ($1, $2, 'email', 'a@exemplo.com')`, [a, alerta]);
    if (existe('notification_settings')) await admin.query('insert into notification_settings (account_id) values ($1)', [a]);
    if (existe('site_notification_prefs')) await admin.query('insert into site_notification_prefs (site_id, account_id) values ($1, $2)', [site, a]);
  });

  it('a lista de tabelas com account_id é a esperada (tabela nova → declare e semeie aqui)', () => {
    expect(ordenar(comAccount)).toEqual(ordenar([...COM_ACCOUNT_ID, ...COM_ACCOUNT_ID_OUTRAS.filter(existe)]));
  });

  it('para cada uma: A vê a própria linha; B e "sem conta" veem zero; sem SELECT, o banco nega', async () => {
    const problemas: string[] = [];
    for (const t of comAccount) {
      const podeLer = (esperadoDe(t).app_web ?? []).includes('SELECT');
      const contar = (conta: string | null) => comoConta(web, conta, async (c) => (await c.query<{ n: number }>(`select count(*)::int as n from ${t} where account_id = $1`, [A.accountId])).rows[0]!.n);
      if (!podeLer) {
        await expect(contar(B.accountId), `${t}: app_web não deveria ter SELECT`).rejects.toThrow(/permission denied/);
        continue;
      }
      const [comoA, comoB, semConta] = [await contar(A.accountId), await contar(B.accountId), await contar(null)];
      if (comoA < 1) problemas.push(`${t}: a semente de A não apareceu para A (teste vazio)`);
      if (comoB !== 0) problemas.push(`${t}: B enxerga ${comoB} linha(s) de A`);
      if (semConta !== 0) problemas.push(`${t}: sem contexto de conta, ${semConta} linha(s) visível(is)`);
    }
    // accounts: a política é por id.
    const contas = await comoConta(web, B.accountId, async (c) => (await c.query<{ n: number }>('select count(*)::int as n from accounts where id = $1', [A.accountId])).rows[0]!.n);
    if (contas !== 0) problemas.push('accounts: B enxerga a conta A');
    expect(problemas).toEqual([]);
  });

  it('as escritas que a Fase 5 concede à central funcionam na própria conta e viram zero linhas na alheia', async () => {
    const sub = (conta: string) => comoConta(web, conta, async (c) => (await c.query(`update submissions set fields = '{}'::jsonb where account_id = $1 returning id`, [A.accountId])).rowCount);
    expect(await sub(B.accountId)).toBe(0);
    expect(await sub(A.accountId)).toBe(1);
    const ident = (conta: string) => comoConta(web, conta, async (c) => (await c.query('delete from contact_identities where account_id = $1 returning id', [A.accountId])).rowCount);
    expect(await ident(B.accountId)).toBe(0);
    // Mesclagem de conflito ("mesma pessoa") move contact_id em identidades e envios: grant por coluna.
    const move = await comoConta(web, A.accountId, async (c) => {
      const k = (await c.query<{ e: string; p: string }>('select email_contact_id as e, phone_contact_id as p from contact_conflicts limit 1')).rows[0]!;
      const i = await c.query('update contact_identities set contact_id = $1 where contact_id = $2 returning id', [k.p, k.e]);
      const s = await c.query('update submissions set contact_id = $1 where contact_id = $2 returning id', [k.p, k.e]);
      return { i: i.rowCount, s: s.rowCount };
    });
    expect(move).toEqual({ i: 1, s: 1 });
    expect(await ident(A.accountId)).toBe(1);
    // O que NÃO foi concedido continua negado: a central não promove um envio a "destino confirmado".
    await expect(comoConta(web, A.accountId, (c) => c.query(`update submissions set receipt_status = 'confirmado_destino' where account_id = $1`, [A.accountId]))).rejects.toThrow(/permission denied/);
  });
});

describe('c) funções SECURITY DEFINER do schema app', () => {
  it('são exatamente as declaradas; só app_web executa; PUBLIC não; search_path fixo', async () => {
    const fns = await admin.query<{ oid: number; nome: string; definer: boolean; tem_acl: boolean; publico: boolean; config: string }>(
      `select p.oid, p.proname as nome, p.prosecdef as definer, p.proacl is not null as tem_acl,
              exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0) as publico,
              coalesce(array_to_string(p.proconfig, ','), '') as config
         from pg_proc p where p.pronamespace = 'app'::regnamespace order by 1`,
    );
    expect(ordenar(fns.rows.filter((f) => f.definer).map((f) => f.nome))).toEqual(ordenar(FUNCOES_DEFINER));
    expect(ordenar(fns.rows.filter((f) => !f.definer).map((f) => f.nome))).toEqual(ordenar(FUNCOES_COMUNS));
    const problemas: string[] = [];
    for (const f of fns.rows.filter((x) => x.definer)) {
      if (!f.tem_acl || f.publico) problemas.push(`${f.nome}: PUBLIC ainda executa (revoke all ... from public ausente)`);
      if (!/search_path=/.test(f.config)) problemas.push(`${f.nome}: sem "set search_path" (obrigatório em SECURITY DEFINER)`);
      for (const p of PAPEIS) {
        const ok = (await admin.query<{ ok: boolean }>('select has_function_privilege($1, $2::oid, $3) as ok', [p, f.oid, 'EXECUTE'])).rows[0]!.ok;
        if (p === 'app_web' && !ok) problemas.push(`${f.nome}: app_web NÃO executa`);
        if (p !== 'app_web' && ok) problemas.push(`${f.nome}: ${p} executa (só a central deveria)`);
      }
    }
    expect(problemas).toEqual([]);
    // Nenhuma SECURITY DEFINER fora do schema app.
    expect((await admin.query<{ n: number }>("select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and prosecdef")).rows[0]!.n).toBe(0);
  });

  it('na prática: o worker e os papéis públicos não conseguem chamar login nem sessão', async () => {
    for (const pool of [worker, ingest, forms]) {
      await expect(pool.query("select * from app.find_user_for_login('x@y.z')")).rejects.toThrow(/permission denied/);
      await expect(pool.query("select * from app.find_user_for_session('abc')")).rejects.toThrow(/permission denied/);
    }
    await expect(worker.query('select * from auth_sessions')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from users')).rejects.toThrow(/permission denied/);
  });
});

describe('d) RLS ativa e forçada em toda tabela', () => {
  it('falha listando as que não têm (exceto as isentas, com motivo)', async () => {
    const r = await admin.query<{ t: string; ativa: boolean; forcada: boolean }>(
      "select relname as t, relrowsecurity as ativa, relforcerowsecurity as forcada from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1",
    );
    const sem = r.rows.filter((x) => !(x.ativa && x.forcada) && !SEM_RLS[x.t]).map((x) => `${x.t} (ativa=${x.ativa}, forçada=${x.forcada})`);
    expect(sem).toEqual([]);
    for (const t of Object.keys(SEM_RLS)) expect(esperadoDe(t), `${t} isenta de RLS não pode ter grant`).toEqual({});
  });

  it('worker_heartbeats sob RLS continua funcionando: o worker grava e a central lê', async () => {
    await worker.query("insert into worker_heartbeats (worker_id, version) values ('w-teste', 'v') on conflict (worker_id) do update set seen_at = now()");
    const n = await comoConta(web, null, async (c) => (await c.query<{ n: number }>("select count(*)::int as n from worker_heartbeats where worker_id = 'w-teste'")).rows[0]!.n);
    expect(n).toBe(1);
  });
});

describe('e) privilégio por coluna da retenção (0007)', () => {
  it('o worker anonimiza sem conseguir ler nome, e-mail ou telefone, nem mexer no estado do recebimento', async () => {
    await expect(worker.query('select name from contacts')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select value from contact_identities')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from contacts')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select fields from submissions')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select * from submissions')).rejects.toThrow(/permission denied/);
    await expect(worker.query('select id, site_id, contact_id from submissions')).resolves.toBeTruthy();
    await expect(worker.query(`update submissions set receipt_status = 'confirmado_destino'`)).rejects.toThrow(/permission denied/);
    await expect(worker.query(`update contacts set first_real_at = now()`)).rejects.toThrow(/permission denied/);
    await expect(worker.query(`insert into contact_identities (account_id, site_id, contact_id, kind, value) select account_id, site_id, id, 'email', 'x@y.z' from contacts limit 1`)).rejects.toThrow(/permission denied/);
    // O que a varredura precisa, ele tem.
    await expect(worker.query('select id, site_id, last_real_at, anonymized_at from contacts')).resolves.toBeTruthy();
    await expect(worker.query('select contact_retention_policy, contact_retention_days from site_tracking')).resolves.toBeTruthy();
  });

  it('os papéis públicos não ganharam nada com a Fase 5', async () => {
    await expect(ingest.query('select 1 from contacts')).rejects.toThrow(/permission denied/);
    await expect(ingest.query('select 1 from submissions')).rejects.toThrow(/permission denied/);
    await expect(forms.query('select 1 from users')).rejects.toThrow(/permission denied/);
    await expect(forms.query('delete from contact_identities')).rejects.toThrow(/permission denied/);
  });
});
