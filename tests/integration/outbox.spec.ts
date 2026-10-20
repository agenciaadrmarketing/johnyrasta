import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { BANCO_TESTE, comoConta, criarConta, prepararBanco, urls } from './apoio';
import { rodadaOutbox } from '../../worker/outbox';
import type { Enviador, PedidoDeEmail, ResultadoDoEnvio } from '../../worker/email';

/**
 * Outbox de e-mail contra o Postgres real (banco `johnyweb_test_notif`), com o
 * provedor substituído por uma função controlada. O que se prova:
 * não reenvio, backoff, falha definitiva, respeito às preferências, corte
 * temporal e permissão do papel da central.
 */
let admin: Client;
let web: Pool;
let worker: Pool;
let conta: { accountId: string; userId: string };
let siteA: string;
let siteB: string;
let relogio = new Date('2026-10-20T12:00:00Z');
const avanca = (min: number) => { relogio = new Date(relogio.getTime() + min * 60_000); };

const enviados: PedidoDeEmail[] = [];
let resposta: ResultadoDoEnvio = { ok: true, id: 'msg' };
const enviarFalso: Enviador = async (p) => {
  enviados.push(p);
  return resposta;
};
const rodar = (enviar: Enviador | null = enviarFalso) =>
  rodadaOutbox(worker, { enviar, provedor: 'teste', urlDaCentral: 'https://central.teste', agora: () => relogio, aleatorio: () => 0.5 });

let seq = 0;
async function inserirAlerta(kind: string, siteId: string | null, criadoEm: Date = relogio, details: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const r = await admin.query<{ id: string }>(
    `insert into alerts (account_id, site_id, kind, severity, dedupe_key, title, details, created_at)
     values ($1, $2, $3, 'alta', $4, $5, $6, $7) returning id`,
    [conta.accountId, siteId, kind, `t:${seq}`, `Alerta ${seq}`, JSON.stringify(details), criadoEm],
  );
  return r.rows[0]!.id;
}
const entregasDe = (alertId: string) => admin.query('select recipient, state, attempts, next_attempt_at, last_error, provider, provider_message_id, sent_at from alert_deliveries where alert_id = $1 order by recipient', [alertId]);

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  admin = new Client({ connectionString: u.admin });
  await admin.connect();
  web = new Pool({ connectionString: u.web, max: 2 });
  const wu = new URL(process.env.DATABASE_URL_WORKER!);
  wu.pathname = `/${BANCO_TESTE}`;
  worker = new Pool({ connectionString: wu.toString(), max: 6 });
  conta = await criarConta(admin, 'Conta Notif');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'C']);
  const a = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone) values ($1, $2, 'Loja Alfa', 'lojaalfa.com.br', 'https://lojaalfa.com.br/', 'pubA', 'America/Sao_Paulo') returning id`, [conta.accountId, c.rows[0]!.id]);
  const b = await admin.query<{ id: string }>(`insert into sites (account_id, client_id, name, domain, primary_url, public_id) values ($1, $2, 'Blog Beta', 'blogbeta.com', 'https://blogbeta.com/', 'pubB') returning id`, [conta.accountId, c.rows[0]!.id]);
  siteA = a.rows[0]!.id;
  siteB = b.rows[0]!.id;
  // Preferências com dois destinatários, salvas um minuto ANTES do relógio dos alertas.
  await admin.query(
    `insert into notification_settings (account_id, email_enabled, email_recipients, updated_at) values ($1, true, $2, $3)`,
    [conta.accountId, ['um@teste.local', 'dois@teste.local'], new Date(relogio.getTime() - 60_000)],
  );
});
afterAll(async () => {
  await worker.end();
  await web.end();
  await admin.end();
});

describe('outbox de e-mail', () => {
  it('sem provedor: a rodada não enfileira nem envia nada', async () => {
    const alerta = await inserirAlerta('incidente_confirmado', siteA);
    expect(await rodar(null)).toMatchObject({ enfileiradas: 0, reivindicadas: 0, enviadas: 0 });
    expect((await entregasDe(alerta)).rowCount).toBe(0);
    await admin.query('delete from alerts where id = $1', [alerta]);
  });

  it('(i) 1 alerta → 2 entregas enviadas; 10 rodadas depois continuam 2 (não reenvia)', async () => {
    const alerta = await inserirAlerta('incidente_confirmado', siteA, relogio, { category: 'http', httpStatus: 503, firstFailureAt: '2026-10-20T11:55:00Z', confirmedAt: '2026-10-20T12:00:00Z' });
    const r = await rodar();
    expect(r).toMatchObject({ enfileiradas: 2, reivindicadas: 2, enviadas: 2, falhas: 0 });
    const e = await entregasDe(alerta);
    expect(e.rows.map((x) => [x.recipient, x.state, x.attempts, x.provider, x.provider_message_id])).toEqual([
      ['dois@teste.local', 'enviado', 1, 'teste', 'msg'],
      ['um@teste.local', 'enviado', 1, 'teste', 'msg'],
    ]);
    expect(enviados).toHaveLength(2);
    expect(enviados[0]!.subject).toBe('[JohnyWeb] Loja Alfa: indisponível para o monitor');
    expect(enviados[0]!.text).toContain('https://central.teste/sites/' + siteA + '/disponibilidade');
    expect(enviados[0]!.text).toContain('Primeira falha observada: 20/10/2026, 08:55');
    expect(enviados[0]!.alertId).toBe(alerta);
    for (let k = 0; k < 10; k++) {
      avanca(5);
      const rk = await rodar();
      expect(rk).toMatchObject({ enfileiradas: 0, reivindicadas: 0, enviadas: 0 });
    }
    expect((await admin.query('select count(*)::int as n from alert_deliveries')).rows[0].n).toBe(2);
    expect(enviados).toHaveLength(2);
  });

  it('abertura e recuperação são alertas distintos: cada um tem a própria entrega, nada repetido', async () => {
    const rec = await inserirAlerta('incidente_recuperado', siteA, relogio, { firstFailureAt: '2026-10-20T11:55:00Z', recoveredAt: relogio.toISOString(), observedDurationMs: 55 * 60_000 });
    enviados.length = 0;
    expect(await rodar()).toMatchObject({ enfileiradas: 2, enviadas: 2 });
    expect(enviados.map((p) => p.subject)).toEqual(['[JohnyWeb] Loja Alfa: respondendo de novo', '[JohnyWeb] Loja Alfa: respondendo de novo']);
    expect((await entregasDe(rec)).rowCount).toBe(2);
    expect((await admin.query('select count(*)::int as n from alert_deliveries')).rows[0].n).toBe(4);
  });

  it('(ii) transitório: attempts sobe, next_attempt_at no futuro, continua pendente; depois ok → enviado', async () => {
    const alerta = await inserirAlerta('tls_vencendo', siteA, relogio, { expiresAt: '2026-11-01T00:00:00Z', faixaDias: 14 });
    resposta = { ok: false, erro: 'HTTP 429: rate limited', transitorio: true };
    expect(await rodar()).toMatchObject({ enfileiradas: 2, reivindicadas: 2, reagendadas: 2, enviadas: 0, falhas: 0 });
    let e = await entregasDe(alerta);
    expect(e.rows.every((x) => x.state === 'pendente' && x.attempts === 1 && x.last_error === 'HTTP 429: rate limited')).toBe(true);
    // Backoff da 1ª tentativa com jitter 0,5 = exatamente 1 min.
    expect(e.rows.every((x) => new Date(x.next_attempt_at).getTime() === relogio.getTime() + 60_000)).toBe(true);
    // Antes da hora: não reivindica.
    expect((await rodar()).reivindicadas).toBe(0);
    avanca(1);
    resposta = { ok: true, id: 'msg-2' };
    expect(await rodar()).toMatchObject({ reivindicadas: 2, enviadas: 2 });
    e = await entregasDe(alerta);
    expect(e.rows.every((x) => x.state === 'enviado' && x.attempts === 2 && x.provider_message_id === 'msg-2' && x.last_error === null && x.sent_at !== null)).toBe(true);
  });

  it('transitório repetido esgota max_attempts (5) e vira falhou definitivo; backoff cresce', async () => {
    const alerta = await inserirAlerta('tls_falha', siteA, relogio, { detail: 'expired' });
    resposta = { ok: false, erro: 'HTTP 503', transitorio: true };
    const atrasos: number[] = [];
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      const r = await rodar();
      expect(r.reivindicadas).toBe(2);
      const e = await entregasDe(alerta);
      if (tentativa < 5) {
        expect(r.reagendadas).toBe(2);
        expect(e.rows[0]!.state).toBe('pendente');
        atrasos.push(new Date(e.rows[0]!.next_attempt_at).getTime() - relogio.getTime());
        relogio = new Date(e.rows[0]!.next_attempt_at);
      } else {
        expect(r.falhas).toBe(2);
        expect(e.rows.every((x) => x.state === 'falhou' && x.attempts === 5)).toBe(true);
      }
    }
    expect(atrasos).toEqual([60_000, 120_000, 240_000, 480_000]);
    // Falhou de vez: nenhuma rodada futura pega de novo.
    avanca(60);
    expect((await rodar()).reivindicadas).toBe(0);
  });

  it('(iii) 4xx definitivo → falhou na hora, uma tentativa, sem nova tentativa', async () => {
    const alerta = await inserirAlerta('incidente_confirmado', siteA);
    resposta = { ok: false, erro: 'HTTP 400: invalid from', transitorio: false };
    expect(await rodar()).toMatchObject({ reivindicadas: 2, falhas: 2, reagendadas: 0 });
    const e = await entregasDe(alerta);
    expect(e.rows.every((x) => x.state === 'falhou' && x.attempts === 1 && x.last_error === 'HTTP 400: invalid from')).toBe(true);
    avanca(30);
    expect((await rodar()).reivindicadas).toBe(0);
    resposta = { ok: true, id: 'msg' };
  });

  it('(iv) tipo fora da lista → nenhuma entrega; site desligado → nenhuma entrega; alerta sem site segue a conta', async () => {
    await admin.query(`update notification_settings set kinds = array['incidente_confirmado', 'incidente_recuperado', 'fila_parada'] where account_id = $1`, [conta.accountId]);
    const foraDaLista = await inserirAlerta('coletor_parado', siteA);
    await admin.query('insert into site_notification_prefs (site_id, account_id, email_enabled) values ($1, $2, false)', [siteB, conta.accountId]);
    const siteDesligado = await inserirAlerta('incidente_confirmado', siteB);
    const semSite = await inserirAlerta('fila_parada', null, relogio, { pendentes: 3 });
    enviados.length = 0;
    expect(await rodar()).toMatchObject({ enfileiradas: 2, enviadas: 2 });
    expect((await entregasDe(foraDaLista)).rowCount).toBe(0);
    expect((await entregasDe(siteDesligado)).rowCount).toBe(0);
    expect((await entregasDe(semSite)).rowCount).toBe(2);
    expect(enviados[0]!.subject).toBe('[JohnyWeb] Fila de medições do PageSpeed parada');
    expect(enviados[0]!.text).toContain('https://central.teste/atencao');
    // Religar o site B: o alerta antigo dele continua sem entrega? Não — ele ainda está aberto e depois do corte,
    // então passa a ser enfileirado. É o comportamento esperado: a decisão vale a partir do momento em que é tomada.
    await admin.query('update site_notification_prefs set email_enabled = true where site_id = $1', [siteB]);
    expect((await rodar()).enfileiradas).toBe(2);
    expect((await entregasDe(siteDesligado)).rowCount).toBe(2);
  });

  it('(v) alerta anterior ao updated_at das preferências → nenhuma entrega; alerta resolvido → nenhuma entrega', async () => {
    await admin.query('update notification_settings set updated_at = $2 where account_id = $1', [conta.accountId, relogio]);
    const antigo = await inserirAlerta('incidente_confirmado', siteA, new Date(relogio.getTime() - 1));
    const resolvido = await inserirAlerta('incidente_confirmado', siteA, relogio);
    await admin.query(`update alerts set state = 'resolvido', resolved_at = $2 where id = $1`, [resolvido, relogio]);
    expect(await rodar()).toMatchObject({ enfileiradas: 0, reivindicadas: 0 });
    expect((await entregasDe(antigo)).rowCount).toBe(0);
    expect((await entregasDe(resolvido)).rowCount).toBe(0);
  });

  it('preferência desligada entre enfileirar e enviar → descartado, nada enviado', async () => {
    const alerta = await inserirAlerta('incidente_confirmado', siteA);
    // Enfileira (provedor que nunca responde a tempo não importa aqui: só queremos a fila).
    resposta = { ok: false, erro: 'HTTP 503', transitorio: true };
    expect(await rodar()).toMatchObject({ enfileiradas: 2, reagendadas: 2 });
    await admin.query('update notification_settings set email_enabled = false where account_id = $1', [conta.accountId]);
    avanca(2);
    enviados.length = 0;
    expect(await rodar()).toMatchObject({ reivindicadas: 2, descartadas: 2, enviadas: 0 });
    expect(enviados).toHaveLength(0);
    const e = await entregasDe(alerta);
    expect(e.rows.every((x) => x.state === 'descartado')).toBe(true);
    await admin.query('update notification_settings set email_enabled = true where account_id = $1', [conta.accountId]);
    resposta = { ok: true, id: 'msg' };
  });

  it('adaptador que lança exceção é tratado como transitório, não derruba a rodada', async () => {
    const alerta = await inserirAlerta('incidente_confirmado', siteA);
    const quebrado: Enviador = async () => { throw new Error('explodiu'); };
    expect(await rodar(quebrado)).toMatchObject({ reivindicadas: 2, reagendadas: 2 });
    const e = await entregasDe(alerta);
    expect(e.rows[0]!.last_error).toContain('explodiu');
    expect(e.rows[0]!.state).toBe('pendente');
  });

  it('(vi) permissões: app_web lê entregas da própria conta e NÃO insere; outra conta não vê nada', async () => {
    const minhas = await comoConta(web, conta.accountId, (c) => c.query('select count(*)::int as n from alert_deliveries'));
    expect(minhas.rows[0].n).toBeGreaterThan(0);
    const outra = await criarConta(admin, 'Outra');
    const dela = await comoConta(web, outra.accountId, (c) => c.query('select count(*)::int as n from alert_deliveries'));
    expect(dela.rows[0].n).toBe(0);
    const alerta = (await admin.query('select id from alerts limit 1')).rows[0].id;
    await expect(
      comoConta(web, conta.accountId, (c) => c.query(`insert into alert_deliveries (account_id, alert_id, channel, recipient) values ($1, $2, 'email', 'x@y.z')`, [conta.accountId, alerta])),
    ).rejects.toThrow(/permission denied/);
    // app_web edita as próprias preferências; a preferência de site exige site da conta (RLS em sites → nenhuma linha).
    await comoConta(web, conta.accountId, (c) => c.query(`insert into notification_settings (account_id, email_enabled) values ($1, true) on conflict (account_id) do update set updated_at = now()`, [conta.accountId]));
    const r = await comoConta(web, outra.accountId, (c) =>
      c.query(`insert into site_notification_prefs (site_id, account_id, email_enabled) select s.id, s.account_id, false from sites s where s.id = $1 returning site_id`, [siteA]),
    );
    expect(r.rowCount).toBe(0);
    // app_worker não enxerga usuários nem sessões.
    await expect(worker.query('select * from users')).rejects.toThrow(/permission denied/);
  });

  it('unique (alert_id, channel, recipient) é constraint do banco, não só do código', async () => {
    const alerta = (await admin.query("select alert_id from alert_deliveries limit 1")).rows[0].alert_id;
    const rec = (await admin.query('select recipient from alert_deliveries where alert_id = $1 limit 1', [alerta])).rows[0].recipient;
    await expect(admin.query(`insert into alert_deliveries (account_id, alert_id, channel, recipient) values ($1, $2, 'email', $3)`, [conta.accountId, alerta, rec])).rejects.toThrow(/duplicate key|unique/);
  });
});
