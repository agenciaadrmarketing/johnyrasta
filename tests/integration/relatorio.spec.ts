import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { criarConta, prepararBanco, urls } from './apoio';
import { periodoDoRelatorio, type PeriodoDoRelatorio } from '@/modules/reports/periodo';
import { incidentesNoPeriodo } from '@/modules/reports/regras';

/**
 * R01 — o relatório é COMPOSIÇÃO das consultas das abas.
 *
 * As consultas usam `comConta`, que abre o pool a partir de `DATABASE_URL` na
 * PRIMEIRA chamada (não na importação). Por isso o teste troca a variável
 * para o banco de teste antes de importar dinamicamente os módulos — e no
 * fim encerra o pool que `src/shared/db` guarda em `globalThis`.
 */
type Consultas = typeof import('@/modules/reports/consultas');
type Analytics = typeof import('@/modules/analytics/consultas');
type Monitoring = typeof import('@/modules/monitoring/consultas');
type Contacts = typeof import('@/modules/contacts/consultas');

let admin: Client;
let rel: Consultas;
let an: Analytics;
let mon: Monitoring;
let ct: Contacts;
let conta: { accountId: string; userId: string };
let outra: { accountId: string; userId: string };
let clienteId: string;
let siteId: string;
let siteArquivadoId: string;
let monitorId: string;

const SP = 'America/Sao_Paulo';
// Relógio fixo: 20/10/2026 15:00Z = 12:00 em São Paulo.
const agora = new Date('2026-10-20T15:00:00Z');
const id = (p: string) => `${p}-${randomBytes(5).toString('hex')}`;

async function sessao(opcoes: { startedAt: string; source?: string; medium?: string | null; isTest?: boolean; visitor?: string }): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `insert into sessions (account_id, site_id, session_key, visitor_id, started_at, last_seen_at, source, medium, is_test)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8) returning id`,
    [conta.accountId, siteId, id('sess'), opcoes.visitor ?? id('vis'), opcoes.startedAt, opcoes.source ?? 'direto', opcoes.medium ?? null, opcoes.isTest ?? false],
  );
  return r.rows[0]!.id;
}
async function evento(sessionId: string, o: { type: 'page_view' | 'click' | 'form_attempt'; at: string; path?: string; isTest?: boolean; buttonId?: string | null; kind?: string | null; pos?: string | null; visitor?: string | null }): Promise<number> {
  const r = await admin.query<{ id: number }>(
    `insert into events (account_id, site_id, event_id, session_id, visitor_id, type, path, button_id, button_pos, action_kind, occurred_at, is_test)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [conta.accountId, siteId, id('evt'), sessionId, o.visitor ?? null, o.type, o.path ?? '/', o.buttonId ?? null, o.pos ?? null, o.kind ?? null, o.at, o.isTest ?? false],
  );
  return r.rows[0]!.id;
}
async function submissao(o: { at: string; status?: string; evidence?: string; mode?: string; isTest?: boolean; isNewLead?: boolean; sessionId?: string | null; attributed?: number | null; fields?: Record<string, string> }): Promise<void> {
  await admin.query(
    `insert into submissions (account_id, site_id, submission_id, mode, receipt_status, evidence_source, page_path, session_id, fields, attributed_event_id, attribution, is_test, is_new_lead, occurred_at)
     values ($1, $2, $3, $4, $5, $6, '/contato', $7, $8, $9, $10, $11, $12, $13)`,
    [
      conta.accountId, siteId, id('sub'), o.mode ?? 'endpoint', o.status ?? 'recebido', o.evidence ?? 'endpoint', o.sessionId ?? null,
      JSON.stringify(o.fields ?? { name: 'Ana', email: 'ana@ex.com', message: 'texto livre que não vai para o relatório' }),
      o.attributed ?? null, o.attributed ? 'ultimo_clique' : 'sem_atribuicao', o.isTest ?? false, o.isNewLead ?? false, o.at,
    ],
  );
}

beforeAll(async () => {
  await prepararBanco();
  const u = urls();
  // ANTES de importar quem cria pool: o `comConta` da aplicação precisa falar com o banco de teste.
  process.env.DATABASE_URL = u.web;
  rel = await import('@/modules/reports/consultas');
  an = await import('@/modules/analytics/consultas');
  mon = await import('@/modules/monitoring/consultas');
  ct = await import('@/modules/contacts/consultas');

  admin = new Client({ connectionString: u.admin });
  await admin.connect();
  conta = await criarConta(admin, 'Conta Relatório');
  outra = await criarConta(admin, 'Outra Conta');
  const c = await admin.query<{ id: string }>('insert into clients (account_id, name) values ($1, $2) returning id', [conta.accountId, 'Cliente R']);
  clienteId = c.rows[0]!.id;
  const s = await admin.query<{ id: string }>(
    `insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone) values ($1, $2, 'Site SP', 'relatorio.test', 'https://relatorio.test/', 'pub-rel-1', $3) returning id`,
    [conta.accountId, clienteId, SP],
  );
  siteId = s.rows[0]!.id;
  const arq = await admin.query<{ id: string }>(
    `insert into sites (account_id, client_id, name, domain, primary_url, public_id, timezone, archived_at) values ($1, $2, 'Arquivado', 'velho.test', 'https://velho.test/', 'pub-rel-2', $3, now()) returning id`,
    [conta.accountId, clienteId, SP],
  );
  siteArquivadoId = arq.rows[0]!.id;
  const m = await admin.query<{ id: string }>(`insert into monitors (account_id, site_id, url) values ($1, $2, 'https://relatorio.test/') returning id`, [conta.accountId, siteId]);
  monitorId = m.rows[0]!.id;

  // Incidentes: um dentro do período de outubro (confirmado e recuperado), um antigo (setembro) fora dele.
  await admin.query(
    `insert into incidents (account_id, monitor_id, site_id, first_failure_at, confirmed_at, recovered_at, outcome, cause_category, failed_checks)
     values ($1, $2, $3, '2026-10-05T10:00:00Z', '2026-10-05T10:05:00Z', '2026-10-05T11:00:00Z', 'confirmado', 'http', 12),
            ($1, $2, $3, '2026-09-01T10:00:00Z', '2026-09-01T10:05:00Z', '2026-09-01T10:30:00Z', 'confirmado', 'timeout', 6)`,
    [conta.accountId, monitorId, siteId],
  );

  // Sessões e eventos reais dentro de 01/10–07/10 (SP).
  const s1 = await sessao({ startedAt: '2026-10-02T13:00:00Z', source: 'google', medium: 'organico', visitor: 'v1' });
  await evento(s1, { type: 'page_view', at: '2026-10-02T13:00:00Z', visitor: 'v1' });
  await evento(s1, { type: 'page_view', at: '2026-10-02T13:01:00Z', path: '/contato', visitor: 'v1' });
  const clique1 = await evento(s1, { type: 'click', at: '2026-10-02T13:02:00Z', path: '/contato', buttonId: 'whats-rodape', kind: 'whatsapp', pos: 'rodape', visitor: 'v1' });
  await submissao({ at: '2026-10-02T13:05:00Z', sessionId: s1, attributed: clique1, isNewLead: true });

  const s2 = await sessao({ startedAt: '2026-10-03T20:00:00Z', source: 'meta', medium: 'cpc', visitor: 'v2' });
  await evento(s2, { type: 'page_view', at: '2026-10-03T20:00:00Z', visitor: 'v2' });
  await evento(s2, { type: 'click', at: '2026-10-03T20:01:00Z', path: '/contato', buttonId: 'whats-rodape', kind: 'whatsapp', pos: 'rodape', visitor: 'v2' });
  await evento(s2, { type: 'click', at: '2026-10-03T20:02:00Z', buttonId: 'auto-phone', kind: 'phone', visitor: 'v2' });
  await evento(s2, { type: 'form_attempt', at: '2026-10-03T20:03:00Z', path: '/contato', visitor: 'v2' });
  await submissao({ at: '2026-10-03T20:04:00Z', sessionId: s2, status: 'confirmado_destino', evidence: 'webhook', mode: 'webhook', fields: { phone: '+5511988887777' } });
  await submissao({ at: '2026-10-03T20:10:00Z', sessionId: s2, status: 'tentativa', evidence: 'auxiliar', mode: 'auxiliar', fields: {} });

  // Diagnóstico (is_test): NÃO entra em nada.
  const st = await sessao({ startedAt: '2026-10-04T12:00:00Z', isTest: true, visitor: 'vt' });
  await evento(st, { type: 'page_view', at: '2026-10-04T12:00:00Z', isTest: true, visitor: 'vt' });
  await evento(st, { type: 'click', at: '2026-10-04T12:01:00Z', isTest: true, buttonId: 'whats-rodape', kind: 'whatsapp', visitor: 'vt' });
  await submissao({ at: '2026-10-04T12:02:00Z', sessionId: st, isTest: true, isNewLead: true });

  // Fronteira T01: 23:59 SP de 07/10 = 02:59Z de 08/10 (DENTRO); 00:00 SP de 08/10 = 03:00Z (FORA).
  const sb = await sessao({ startedAt: '2026-10-08T02:59:00Z', visitor: 'v3' });
  await evento(sb, { type: 'page_view', at: '2026-10-08T02:59:00Z', path: '/fronteira-dentro', visitor: 'v3' });
  await evento(sb, { type: 'click', at: '2026-10-08T02:59:30Z', path: '/fronteira-dentro', buttonId: 'fronteira', kind: 'email', visitor: 'v3' });
  const sf = await sessao({ startedAt: '2026-10-08T03:00:00Z', visitor: 'v4' });
  await evento(sf, { type: 'page_view', at: '2026-10-08T03:00:00Z', path: '/fronteira-fora', visitor: 'v4' });
  await evento(sf, { type: 'click', at: '2026-10-08T03:00:30Z', path: '/fronteira-fora', buttonId: 'fora', kind: 'email', visitor: 'v4' });
  // E o início: 02:59:59Z de 01/10 ainda é 30/09 em SP (FORA).
  const si = await sessao({ startedAt: '2026-10-01T02:59:59Z', visitor: 'v5' });
  await evento(si, { type: 'page_view', at: '2026-10-01T02:59:59Z', path: '/antes-do-inicio', visitor: 'v5' });
});

afterAll(async () => {
  const pools = (globalThis as { __johnyPools?: Map<string, Pool> }).__johnyPools;
  if (pools) for (const p of pools.values()) await p.end().catch(() => {});
  await admin?.end();
});

function periodo(de: string, ate: string): PeriodoDoRelatorio {
  const r = periodoDoRelatorio({ de, ate }, SP, agora);
  if (!r.ok) throw new Error(r.erro);
  return r.periodo;
}

describe('R01: relatório do site = mesmas consultas das abas', () => {
  it('números batem um a um com resumoDeEventos, botoes, origens, porHora, incidentesDoSite e listarSubmissoes para o MESMO período', async () => {
    const p = periodo('2026-10-01', '2026-10-07');
    const r = await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, p, agora);
    expect(r).not.toBeNull();
    const pe = { de: p.de, ate: p.ate, dias: p.dias };

    const [resumo, linhas, orig, horas, incidentes, envios, checagens] = [
      await an.resumoDeEventos(conta.accountId, siteId, pe),
      await an.botoes(conta.accountId, siteId, pe),
      await an.origens(conta.accountId, siteId, pe),
      await an.porHora(conta.accountId, siteId, SP, pe),
      await mon.incidentesDoSite(conta.accountId, siteId, rel.LIMITE_DE_INCIDENTES),
      await ct.listarSubmissoes(conta.accountId, siteId, { de: p.de, ate: p.ate, limite: 1000 }),
      await mon.resumoDeChecagens(conta.accountId, siteId, p.dias * 24),
    ];

    expect(r!.audiencia.resumo).toEqual(resumo);
    expect(r!.acoes.botoes).toEqual(linhas);
    expect(r!.audiencia.origens).toEqual(orig);
    expect(r!.horarios.horas).toEqual(horas);
    expect(r!.disponibilidade.incidentes).toEqual(incidentesNoPeriodo(incidentes, p));
    expect(r!.disponibilidade.checagens).toEqual(checagens);
    expect(r!.contatos.recebidos).toBe(resumo.contatos);
    expect(r!.contatos.novosLeads).toBe(resumo.novosLeads);
    expect(r!.contatos.recentes.map((e) => e.id)).toEqual(envios.filter((e) => e.receiptStatus !== 'tentativa').map((e) => e.id));
    expect(r!.acoes.cliques).toBe(resumo.cliques);

    // E os valores em si, contados à mão na semeadura (sem diagnóstico, sem o evento das 03:00Z):
    expect(resumo).toMatchObject({ visualizacoes: 4, sessoes: 3, visitantes: 3, cliques: 4, tentativasForm: 1, contatos: 2, novosLeads: 1 });
    // Linhas por botão × página × posição. whats-rodape: 2 cliques em 2 sessões, 1 contato atribuído
    // (último clique de s1), 2 sessões que clicaram E converteram (s1 e s2 — a de s2 pelo webhook).
    expect(linhas.map((l) => [l.buttonId, l.path, l.cliques, l.sessoesComClique, l.contatosAtribuidos, l.sessoesConvertidas])).toEqual([
      ['whats-rodape', '/contato', 2, 2, 1, 2],
      ['auto-phone', '/', 1, 1, 0, 1],
      ['fronteira', '/fronteira-dentro', 1, 1, 0, 0],
    ]);
    expect(r!.disponibilidade.incidentes).toHaveLength(1);
    expect(r!.disponibilidade.incidentes[0]!.causeCategory).toBe('http');
  });

  it('eventos e envios de diagnóstico ficam fora; a mensagem livre não vai para o relatório', async () => {
    const r = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-04', '2026-10-04'), agora))!;
    expect(r.audiencia.resumo.visualizacoes).toBe(0);
    expect(r.acoes.botoes).toEqual([]);
    expect(r.contatos.recebidos).toBe(0);
    expect(r.contatos.novosLeads).toBe(0);
    const todos = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-01', '2026-10-07'), agora))!;
    for (const e of todos.contatos.recentes) expect(Object.keys(e.campos)).not.toContain('message');
    expect(todos.contatos.porEvidencia).toEqual([
      { evidencia: 'endpoint', status: 'recebido', total: 1 },
      { evidencia: 'webhook', status: 'confirmado_destino', total: 1 },
    ]);
    expect(todos.contatos.tentativas).toBe(1);
  });

  it('T01: "ate" = 07/10 em SP inclui 02:59Z de 08/10 e exclui 03:00Z; "de" = 01/10 exclui 02:59:59Z de 01/10', async () => {
    const ate07 = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-07', '2026-10-07'), agora))!;
    expect(ate07.audiencia.resumo.visualizacoes).toBe(1); // só /fronteira-dentro
    expect(ate07.acoes.botoes.map((l) => l.buttonId)).toEqual(['fronteira']);
    const ate06 = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-06', '2026-10-06'), agora))!;
    expect(ate06.audiencia.resumo.visualizacoes).toBe(0);
    const dia08 = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-08', '2026-10-08'), agora))!;
    expect(dia08.acoes.botoes.map((l) => l.buttonId)).toEqual(['fora']);
    const de01 = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-01', '2026-10-01'), agora))!;
    expect(de01.audiencia.resumo.visualizacoes).toBe(0); // 02:59:59Z é 30/09 em SP
    const de30set = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-09-30', '2026-09-30'), agora))!;
    expect(de30set.audiencia.resumo.visualizacoes).toBe(1);
    // As horas vêm no fuso do site: o clique das 02:59:30Z aparece às 23h.
    expect(ate07.horarios.horas.find((h) => h.hora === 23)?.cliques).toBe(1);
    expect(ate07.horarios.horas.find((h) => h.hora === 2)?.cliques).toBe(0);
  });

  it('período padrão (janela móvel) usa exatamente a janela de periodoDeDias', async () => {
    const r = periodoDoRelatorio({ dias: '30' }, SP, agora);
    if (!r.ok) throw new Error(r.erro);
    const pd = an.periodoDeDias(30, agora);
    expect(r.periodo.de.getTime()).toBe(pd.de.getTime());
    expect(r.periodo.ate.getTime()).toBe(pd.ate.getTime());
    const relatorio = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, r.periodo, agora))!;
    expect(relatorio.audiencia.resumo).toEqual(await an.resumoDeEventos(conta.accountId, siteId, pd));
    expect(relatorio.cabecalho.periodo.diasPadrao).toBe(30);
  });

  it('cabeçalho, estados honestos e limitações presentes', async () => {
    const r = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, periodo('2026-10-01', '2026-10-07'), agora))!;
    expect(r.cabecalho).toMatchObject({ site: 'Site SP', cliente: 'Cliente R', dominio: 'relatorio.test', fuso: SP, geradoEm: agora, arquivado: false });
    expect(r.disponibilidade.monitor).not.toBeNull();
    expect(r.disponibilidade.checagens).toMatchObject({ amostras: 0, percentual: null, janelaHoras: 7 * 24 });
    expect(r.velocidade.medicoes).toEqual([]);
    expect(r.velocidade.urlsEscolhidas).toBe(0);
    expect(r.horarios.amostraPequena).toBe(true);
    expect(r.horarios.maisAtivas.length).toBeGreaterThan(0);
    expect(r.limitacoes.some((l) => /CTR/.test(l))).toBe(true);
    expect(r.limitacoes.some((l) => /diagnóstico/.test(l))).toBe(true);
  });

  it('A01: outra conta recebe null (nenhuma linha), nunca 403; id malformado também', async () => {
    expect(await rel.relatorioDoSite(outra.accountId, outra.userId, siteId, periodo('2026-10-01', '2026-10-07'), agora)).toBeNull();
    expect(await rel.relatorioDoSite(conta.accountId, conta.userId, 'nao-e-uuid', periodo('2026-10-01', '2026-10-07'), agora)).toBeNull();
    expect(await rel.relatorioDoCliente(outra.accountId, outra.userId, clienteId, periodo('2026-10-01', '2026-10-07'), agora)).toBeNull();
  });
});

describe('relatório do cliente', () => {
  it('um relatório por site ATIVO, com os mesmos números do relatório do site; arquivado fica fora', async () => {
    const p = periodo('2026-10-01', '2026-10-07');
    const r = (await rel.relatorioDoCliente(conta.accountId, conta.userId, clienteId, p, agora))!;
    expect(r.cabecalho).toMatchObject({ cliente: 'Cliente R', sitesAtivos: 1, geradoEm: agora });
    expect(r.sites.map((s) => s.cabecalho.siteId)).toEqual([siteId]);
    expect(r.sites.map((s) => s.cabecalho.siteId)).not.toContain(siteArquivadoId);
    const direto = (await rel.relatorioDoSite(conta.accountId, conta.userId, siteId, p, agora))!;
    expect(r.sites[0]!.audiencia).toEqual(direto.audiencia);
    expect(r.sites[0]!.acoes).toEqual(direto.acoes);
    expect(r.sites[0]!.disponibilidade.incidentes).toEqual(direto.disponibilidade.incidentes);
    expect(await rel.fusosDoCliente(conta.accountId, conta.userId, clienteId)).toEqual([SP]);
  });
});
