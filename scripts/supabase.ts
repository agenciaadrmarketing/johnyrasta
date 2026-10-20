/**
 * Apoio à implantação em PostgreSQL gerenciado (Supabase). Duas ações, ambas com DATABASE_URL_ADMIN:
 *
 *   npx tsx scripts/supabase.ts preflight [VARIAVEL]   (padrão DATABASE_URL_ADMIN; ou DATABASE_URL, DATABASE_URL_WORKER…) somente LEITURA: privilégios, TLS, papéis do Supabase,
 *                                           resolução de DNS (IPv4/IPv6) e latência real de ida e volta
 *   npx tsx scripts/supabase.ts endurecer   tira de `anon` e `authenticated` o acesso às tabelas,
 *                                           sequências e funções de `public` (a API de dados do Supabase
 *                                           não deve alcançar o que é da central). Rode depois de CADA migração.
 *
 * Nada aqui contrata, cria projeto ou altera DNS. `preflight` não grava; `endurecer` só revoga.
 */
import { Client } from 'pg';
import { lookup } from 'node:dns/promises';
import { loadEnv } from './env';
import { configDoPg } from '../src/shared/db/tls';

export type Achado = { nivel: 'ok' | 'aviso' | 'bloqueio'; texto: string };

const PAPEIS_DA_API = ['anon', 'authenticated'];

export function mediana(valores: number[]): number {
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

/** Avaliação pura da URL (modo do pooler, usuário com sufixo, host direto) — testável sem rede. */
export function avaliarUrl(url: string, sufixo = process.env.DB_ROLE_SUFFIX): Achado[] {
  const a: Achado[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return [{ nivel: 'bloqueio', texto: 'URL inválida.' }]; }
  const usuario = decodeURIComponent(u.username);
  const pooler = u.hostname.endsWith('.pooler.supabase.com');
  const direto = /^db\.[a-z0-9]+\.supabase\.co$/.test(u.hostname);
  if (pooler) {
    if (!usuario.includes('.')) a.push({ nivel: 'bloqueio', texto: `No pooler do Supabase o usuário precisa ser "papel.<ref do projeto>"; recebi "${usuario}".` });
    if (u.port === '6543') a.push({ nivel: 'aviso', texto: 'Porta 6543 = modo TRANSAÇÃO do pooler: serve à web, mas NÃO use para migrações, backup (pg_dump) nem para o worker (sem recursos de sessão).' });
    else a.push({ nivel: 'ok', texto: `Pooler em modo sessão (porta ${u.port || '5432'}), compatível com IPv4.` });
  } else if (direto) {
    a.push({ nivel: 'aviso', texto: 'Conexão DIRETA (db.<ref>.supabase.co) é IPv6 apenas, salvo complemento IPv4 pago. A VPS precisa de IPv6 funcional de saída; o preflight testa a resolução.' });
  }
  if ((pooler || direto) && usuario.includes('.') && !sufixo) a.push({ nivel: 'aviso', texto: 'Usuário com ".<ref>" e DB_ROLE_SUFFIX ausente: db:setup criaria um papel com o ponto no nome. Defina DB_ROLE_SUFFIX=<ref>.' });
  const ssl = u.searchParams.get('sslmode');
  if (!ssl) a.push({ nivel: 'aviso', texto: 'Sem sslmode na URL: o código aplica TLS em hosts remotos de qualquer forma; o pg_dump/psql só usam TLS com sslmode=require.' });
  return a;
}

async function preflight(url: string, admin = true): Promise<Achado[]> {
  const achados: Achado[] = [...avaliarUrl(url)];
  const u = new URL(url);
  try {
    const r = await lookup(u.hostname, { all: true });
    const v4 = r.filter((x) => x.family === 4).length;
    const v6 = r.filter((x) => x.family === 6).length;
    achados.push({ nivel: v4 || v6 ? 'ok' : 'bloqueio', texto: `DNS de ${u.hostname}: ${v4} endereço(s) IPv4, ${v6} IPv6.` });
    if (!v4) achados.push({ nivel: 'aviso', texto: 'Host sem IPv4: a VPS precisa de IPv6 de saída. Teste com `curl -6 https://ifconfig.co` ou use o pooler (IPv4).' });
  } catch (e) {
    achados.push({ nivel: 'bloqueio', texto: `Não resolveu ${u.hostname}: ${e instanceof Error ? e.message : e}` });
  }
  const c = new Client(configDoPg(url));
  try {
    await c.connect();
  } catch (e) {
    achados.push({ nivel: 'bloqueio', texto: `Não conectou: ${e instanceof Error ? e.message : e}` });
    return achados;
  }
  try {
    const v = await c.query<{ v: string; n: number }>("select current_setting('server_version') as v, current_setting('server_version_num')::int as n");
    achados.push({ nivel: v.rows[0]!.n >= 140000 ? 'ok' : 'bloqueio', texto: `PostgreSQL ${v.rows[0]!.v} (mínimo 14).` });
    const eu = (await c.query<{ u: string; su: boolean; cr: boolean; cd: boolean; br: boolean; db: string }>(
      `select r.rolname as u, r.rolsuper as su, r.rolcreaterole as cr, r.rolcreatedb as cd, r.rolbypassrls as br, current_database() as db from pg_roles r where r.rolname = current_user`)).rows[0]!;
    if (!admin) {
      achados.push({ nivel: eu.su || eu.br ? 'bloqueio' : 'ok', texto: `Papel "${eu.u}" na aplicação: superusuário=${eu.su}, BYPASSRLS=${eu.br}. ${eu.su || eu.br ? 'NÃO pode ser usado pela aplicação: ignoraria a RLS.' : 'Sem privilégio de ignorar a RLS (correto).'}` });
      const t = async (fn: () => Promise<unknown>, n = 7) => { const m: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await fn(); m.push(performance.now() - t0); } return mediana(m); };
      const tx = await t(async () => { await c.query('begin'); await c.query("select set_config('app.account_id', '', true)"); await c.query('select 1'); await c.query('commit'); });
      achados.push({ nivel: 'ok', texto: `Uma transação da central (begin + set_config + consulta + commit) por esta conexão: ${tx.toFixed(1)} ms (mediana de 7).` });
      return achados;
    }
    achados.push({ nivel: eu.cr || eu.su ? 'ok' : 'bloqueio', texto: `Usuário administrativo "${eu.u}" no banco "${eu.db}": superusuário=${eu.su}, CREATEROLE=${eu.cr}, CREATEDB=${eu.cd}. db:setup precisa criar papéis (CREATEROLE).` });
    // As tabelas têm RLS FORÇADA, que vale até para o dono. Sem BYPASSRLS o administrador não consegue
    // gravar (bootstrap, importação, demo) nem restaurar backup com pg_restore.
    achados.push({ nivel: eu.br || eu.su ? 'ok' : 'bloqueio', texto: `BYPASSRLS do administrador: ${eu.br || eu.su ? 'sim' : 'NÃO — bootstrap, importação e restauração falham com "violates row-level security policy". Use um administrador com BYPASSRLS.'}` });
    try {
      const s = await c.query<{ ssl: boolean }>('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
      achados.push({ nivel: s.rows[0]?.ssl ? 'ok' : 'aviso', texto: s.rows[0]?.ssl ? 'Conexão com TLS.' : 'A conexão NÃO usa TLS (ou o banco não informa).' });
    } catch { achados.push({ nivel: 'aviso', texto: 'pg_stat_ssl indisponível; não foi possível confirmar o TLS.' }); }

    const api = await c.query<{ rolname: string; rolbypassrls: boolean }>('select rolname, rolbypassrls from pg_roles where rolname = any($1)', [[...PAPEIS_DA_API, 'service_role']]);
    if (api.rowCount) {
      achados.push({ nivel: 'aviso', texto: `Papéis da API do Supabase presentes (${api.rows.map((r) => r.rolname + (r.rolbypassrls ? ' [BYPASSRLS]' : '')).join(', ')}). Eles recebem permissões por padrão em tabelas novas de "public": rode "endurecer" depois de migrar e mantenha a service_role key fora de qualquer código.` });
      const padrao = await c.query<{ n: string }>(
        `select count(*)::text as n from pg_default_acl d, aclexplode(d.defaclacl) a
          where d.defaclnamespace = 'public'::regnamespace and a.grantee::regrole::text = any($1)`, [PAPEIS_DA_API]);
      achados.push({ nivel: Number(padrao.rows[0]!.n) ? 'aviso' : 'ok', texto: `Privilégios padrão de "public" para anon/authenticated: ${padrao.rows[0]!.n} entrada(s).` });
      const tabelas = await c.query<{ n: string }>(
        `select count(*)::text as n from pg_class c, aclexplode(c.relacl) a
          where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') and a.grantee::regrole::text = any($1)`, [PAPEIS_DA_API]);
      achados.push({ nivel: Number(tabelas.rows[0]!.n) ? 'aviso' : 'ok', texto: `Concessões de anon/authenticated em objetos de "public": ${tabelas.rows[0]!.n}${Number(tabelas.rows[0]!.n) ? ' → rode "endurecer"' : ''}.` });
    } else {
      achados.push({ nivel: 'ok', texto: 'Sem papéis anon/authenticated/service_role (não parece Supabase).' });
    }
    const app = await c.query<{ rolname: string; rolcanlogin: boolean }>("select rolname, rolcanlogin from pg_roles where rolname like 'app\\_%' order by 1");
    achados.push({ nivel: 'ok', texto: `Papéis da aplicação existentes: ${app.rows.map((r) => r.rolname + (r.rolcanlogin ? '' : ' (nologin)')).join(', ') || 'nenhum ainda'}.` });

    // Latência: o que mais pesa quando o banco é remoto. A central abre uma transação por consulta
    // (begin + set_config + consulta + commit = 4 idas e voltas).
    const t = async (fn: () => Promise<unknown>, n = 7) => { const m: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await fn(); m.push(performance.now() - t0); } return mediana(m); };
    const ida = await t(() => c.query('select 1'));
    const tx = await t(async () => { await c.query('begin'); await c.query("select set_config('app.account_id', '', true)"); await c.query('select 1'); await c.query('commit'); });
    achados.push({ nivel: ida < 30 ? 'ok' : ida < 80 ? 'aviso' : 'bloqueio', texto: `Latência de ida e volta (mediana de 7): ${ida.toFixed(1)} ms. Uma consulta da central na transação padrão: ${tx.toFixed(1)} ms. Uma página com ~6 consultas ≈ ${(tx * 6).toFixed(0)} ms só em rede. Acima de ~30 ms por ida e volta, aproxime a VPS da região do banco.` });
  } finally {
    await c.end();
  }
  return achados;
}

async function endurecer(url: string): Promise<string[]> {
  const c = new Client(configDoPg(url));
  await c.connect();
  const feito: string[] = [];
  try {
    const existentes = (await c.query<{ rolname: string }>('select rolname from pg_roles where rolname = any($1)', [PAPEIS_DA_API])).rows.map((r) => r.rolname);
    if (!existentes.length) return ['Nada a fazer: anon/authenticated não existem neste banco.'];
    const lista = existentes.map((r) => `"${r}"`).join(', ');
    await c.query('begin');
    for (const obj of ['tables', 'sequences', 'functions']) {
      await c.query(`revoke all on all ${obj} in schema public from ${lista}`);
      await c.query(`alter default privileges in schema public revoke all on ${obj} from ${lista}`);
      feito.push(`revogado: ${obj} de public para ${existentes.join(', ')} (inclusive privilégios padrão do usuário atual)`);
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  return feito;
}

if (process.argv[1]?.endsWith('supabase.ts')) {
  loadEnv();
  // `preflight [VARIAVEL]` examina outra URL (ex.: DATABASE_URL_WORKER) em vez da administrativa.
  const variavel = process.argv[3] ?? 'DATABASE_URL_ADMIN';
  const url = process.env[variavel];
  const acao = process.argv[2];
  if (!url || !['preflight', 'endurecer'].includes(acao ?? '')) {
    console.error(`Uso: tsx scripts/supabase.ts preflight [VARIAVEL]|endurecer  (exige ${variavel})`);
    process.exit(1);
  }
  (acao === 'preflight'
    ? preflight(url, variavel === 'DATABASE_URL_ADMIN').then((a) => {
        for (const x of a) console.log(`${x.nivel === 'ok' ? '✓' : x.nivel === 'aviso' ? '!' : '✗'} ${x.texto}`);
        process.exit(a.some((x) => x.nivel === 'bloqueio') ? 1 : 0);
      })
    : endurecer(url).then((f) => { for (const l of f) console.log(`· ${l}`); })
  ).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
