/**
 * Conta de DEMONSTRAÇÃO, separada e identificada (`accounts.is_demo = true`).
 * A interface mostra a faixa de demonstração; nada dela é usado como reserva
 * quando falta um dado real. Nunca rode em produção.
 *
 *   npm run db:demo   → cria demo@johnyweb.local / demo-johnyweb-2026
 */
import { Client } from 'pg';
import { configDoPg } from '../src/shared/db/tls';
import { randomBytes } from 'node:crypto';
import { loadEnv } from './env';
import { hashPassword } from '../src/modules/accounts/password';

const EMAIL = 'demo@johnyweb.local';
const SENHA = 'demo-johnyweb-2026';

async function main() {
  loadEnv();
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== '1') {
    throw new Error('Conta de demonstração em produção exige DEMO_MODE=1 explicitamente.');
  }
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error('Defina DATABASE_URL_ADMIN.');
  const c = new Client(configDoPg(url));
  await c.connect();
  try {
    await c.query('begin');
    const antiga = await c.query<{ id: string }>('select id from accounts where is_demo');
    for (const r of antiga.rows) await c.query('delete from accounts where id = $1', [r.id]);
    const a = await c.query<{ id: string }>("insert into accounts (name, is_demo) values ('Demonstração JohnyWeb', true) returning id");
    const conta = a.rows[0]!.id;
    await c.query('insert into users (account_id, email, password_hash, name) values ($1, $2, $3, $4)', [conta, EMAIL, await hashPassword(SENHA), 'Operador demo']);
    const clientes = [
      ['Clínica Sol (demo)', 'Cliente fictício para demonstração.'],
      ['Padaria Pão & Cia (demo)', 'Cliente fictício para demonstração.'],
      ['Advocacia Lima (demo)', 'Cliente fictício para demonstração.'],
    ];
    const sites: [number, string, string, string, boolean][] = [
      [0, 'Clínica Sol — institucional', 'https://www.clinicasol.exemplo.com.br/', 'wordpress', true],
      [0, 'Clínica Sol — landing botox', 'https://botox.clinicasol.exemplo.com.br/', 'html', true],
      [1, 'Padaria — site', 'https://paoecia.exemplo.com.br/', 'wix', false],
      [2, 'Advocacia Lima — site', 'https://advocacialima.exemplo.com.br/', 'next', true],
    ];
    const ids: string[] = [];
    for (const [nome, notas] of clientes) {
      const r = await c.query<{ id: string }>('insert into clients (account_id, name, notes) values ($1, $2, $3) returning id', [conta, nome, notas]);
      ids.push(r.rows[0]!.id);
    }
    for (const [ci, nome, url, plataforma, monitorar] of sites) {
      const domain = new URL(url).hostname.replace(/^www\./, '');
      const s = await c.query<{ id: string }>(
        `insert into sites (account_id, client_id, name, domain, primary_url, platform, public_id, notes)
         values ($1, $2, $3, $4, $5, $6, $7, 'Site fictício de demonstração.') returning id`,
        [conta, ids[ci], nome, domain, url, plataforma, randomBytes(9).toString('base64url')],
      );
      if (monitorar) await c.query('insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, now())', [conta, s.rows[0]!.id, url]);
    }
    await c.query('commit');
    console.log(`Conta de demonstração pronta. Entre com ${EMAIL} / ${SENHA}`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
