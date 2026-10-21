import { Client } from 'pg';
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { CONTA_A } from './setup-global';

/**
 * Dados de revisão para a conta de teste A do banco de DESENVOLVIMENTO: um cliente e um site com checagens,
 * incidente, medições do PageSpeed e CrUX. Idempotente. Eventos e contatos entram pelos endpoints reais
 * (/api/collect e /api/forms), no teste. Nunca roda fora do banco de desenvolvimento/teste.
 */
export const NOME_CLIENTE = 'Cliente Revisão';
export const NOME_SITE = 'Site Revisão';
export const PUBLIC_ID = 'revisao-pub-1';

export async function semearRevisao(): Promise<{ accountId: string; clienteId: string; siteId: string; publicId: string }> {
  for (const f of ['.env.test', '.env.local']) if (existsSync(f)) config({ path: f, override: false, quiet: true });
  const c = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await c.connect();
  try {
    const conta = (await c.query<{ account_id: string }>('select account_id from users where lower(email) = lower($1)', [CONTA_A.email])).rows[0]!.account_id;
    let cli = (await c.query<{ id: string }>('select id from clients where account_id = $1 and name = $2', [conta, NOME_CLIENTE])).rows[0];
    if (!cli) cli = (await c.query<{ id: string }>('insert into clients (account_id, name, notes) values ($1, $2, $3) returning id', [conta, NOME_CLIENTE, 'Dados de revisão funcional.'])).rows[0]!;
    let site = (await c.query<{ id: string }>('select id from sites where account_id = $1 and public_id = $2', [conta, PUBLIC_ID])).rows[0];
    if (!site) {
      site = (await c.query<{ id: string }>(
        `insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone, platform) values ($1, $2, $3, 'revisao.exemplo.com.br', 'https://www.revisao.exemplo.com.br/', $4, 'America/Sao_Paulo', 'wordpress') returning id`,
        [conta, cli.id, NOME_SITE, PUBLIC_ID],
      )).rows[0]!;
      const mon = (await c.query<{ id: string }>(`insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, 'https://www.revisao.exemplo.com.br/', now() + interval '1 hour') returning id`, [conta, site.id])).rows[0]!;
      // 48 h de checagens a cada 30 min, com uma falha confirmada e recuperada.
      await c.query(
        `insert into checks (account_id, monitor_id, site_id, checked_at, ok, http_status, duration_ms, final_url, tls_expires_at)
         select $1, $2, $3, now() - (g * interval '30 minutes'), not (g between 20 and 23), case when g between 20 and 23 then 503 else 200 end, 120 + (g % 7) * 15, 'https://www.revisao.exemplo.com.br/', now() + interval '60 days'
           from generate_series(0, 95) g`,
        [conta, mon.id, site.id],
      );
      await c.query(
        `insert into incidents (account_id, monitor_id, site_id, first_failure_at, confirmed_at, recovered_at, outcome, cause_category, cause_detail, failed_checks)
         values ($1, $2, $3, now() - interval '11 hours', now() - interval '10 hours 30 minutes', now() - interval '9 hours', 'confirmado', 'http', 'HTTP 503', 4)`,
        [conta, mon.id, site.id],
      );
      await c.query(`update monitors set last_check_at = now() - interval '2 minutes', last_ok = true, tls_expires_at = now() + interval '60 days', tls_state = 'valido' where id = $1`, [mon.id]);
      await c.query(
        `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details, state, created_at, resolved_at, resolved_by)
         values ($1, $2, 'incidente_confirmado', 'alta', 'revisao:inc1', 'Indisponível para o monitor', '{"category":"http","httpStatus":503}', 'resolvido', now() - interval '10 hours 30 minutes', now() - interval '9 hours', 'worker')`,
        [conta, site.id],
      );
      const mu = (await c.query<{ id: string }>(`insert into monitored_urls (account_id, site_id, url) values ($1, $2, 'https://www.revisao.exemplo.com.br/') returning id`, [conta, site.id])).rows[0]!;
      for (const [dev, perf, dias] of [['mobile', 71, 3], ['mobile', 64, 2], ['mobile', 52, 1], ['desktop', 90, 3], ['desktop', 88, 1]] as const) {
        await c.query(
          `insert into performance_runs (account_id, site_id, monitored_url_id, url, device, measured_at, status, performance, accessibility, best_practices, seo, lcp_ms, cls, tbt_ms, fcp_ms, speed_index_ms, lighthouse_version, source_version, regression)
           values ($1, $2, $3, 'https://www.revisao.exemplo.com.br/', $4, now() - ($5 * interval '1 day'), 'ok', $6, 92, 100, 95, 2800, 0.08, 310, 1500, 3200, '12.0.0', 'psi-v5', $7)`,
          [conta, site.id, mu.id, dev, dias, perf, perf < 60],
        );
      }
      await c.query(
        `insert into crux_snapshots (account_id, site_id, scope, identifier, device, overall, lcp_p75_ms, inp_p75_ms, cls_p75) values ($1, $2, 'origin', 'https://www.revisao.exemplo.com.br', 'mobile', 'precisa melhorar', 3100, 220, 0.12)`,
        [conta, site.id],
      );
    }
    // Dados que o próprio teste envia (eventos, sessões, contatos) começam limpos a cada execução,
    // para a linha do tempo do Resumo (8 itens) ser determinística.
    await c.query('delete from submissions where site_id = $1', [site.id]);
    await c.query('delete from contacts where site_id = $1', [site.id]);
    await c.query('delete from events where site_id = $1', [site.id]);
    await c.query('delete from sessions where site_id = $1', [site.id]);
    return { accountId: conta, clienteId: cli.id, siteId: site.id, publicId: PUBLIC_ID };
  } finally {
    await c.end();
  }
}
