import 'server-only';
import { comConta } from '@/shared/db';

/**
 * Consultas de eventos. Todas excluem `is_test`. Período no fuso do site.
 * O vocabulário é o do documento: visualização, sessão, clique de intenção,
 * contato recebido, novo lead. Nenhuma "venda", nenhum "CTR de botão".
 */
export type Periodo = { de: Date; ate: Date; dias: number };

export function periodoDeDias(dias: number, agora = new Date()): Periodo {
  return { de: new Date(agora.getTime() - dias * 86_400_000), ate: agora, dias };
}

export type ResumoDeEventos = { visualizacoes: number; sessoes: number; visitantes: number; cliques: number; tentativasForm: number; contatos: number; novosLeads: number; ultimoEvento: Date | null; primeiroEvento: Date | null };

export async function resumoDeEventos(accountId: string, siteId: string, p: Periodo): Promise<ResumoDeEventos> {
  const r = await comConta(accountId, (db) =>
    db.one<ResumoDeEventos>(
      `select (select count(*)::int from events where site_id = $1 and not is_test and type = 'page_view' and occurred_at between $2 and $3) as visualizacoes,
              (select count(distinct session_id)::int from events where site_id = $1 and not is_test and occurred_at between $2 and $3) as sessoes,
              (select count(distinct visitor_id)::int from events where site_id = $1 and not is_test and visitor_id is not null and occurred_at between $2 and $3) as visitantes,
              (select count(*)::int from events where site_id = $1 and not is_test and type = 'click' and occurred_at between $2 and $3) as cliques,
              (select count(*)::int from events where site_id = $1 and not is_test and type = 'form_attempt' and occurred_at between $2 and $3) as "tentativasForm",
              (select count(*)::int from submissions where site_id = $1 and not is_test and receipt_status <> 'tentativa' and occurred_at between $2 and $3) as contatos,
              (select count(*)::int from submissions where site_id = $1 and not is_test and is_new_lead and occurred_at between $2 and $3) as "novosLeads",
              (select max(occurred_at) from events where site_id = $1 and not is_test) as "ultimoEvento",
              (select min(occurred_at) from events where site_id = $1 and not is_test) as "primeiroEvento"`,
      [siteId, p.de, p.ate],
    ),
  );
  return r!;
}

export type LinhaDeBotao = { buttonId: string; path: string; pos: string | null; kind: string; autoDetected: boolean; cliques: number; sessoesComClique: number; contatosAtribuidos: number; sessoesConvertidas: number; ultimoClique: Date };

/** Cliques por botão, página e posição; contatos atribuídos; sessões que clicaram E converteram (denominador compatível). */
export async function botoes(accountId: string, siteId: string, p: Periodo): Promise<LinhaDeBotao[]> {
  return comConta(accountId, (db) =>
    db.query<LinhaDeBotao>(
      `with c as (
         select e.id, coalesce(e.button_id, 'auto-' || e.action_kind) as button_id, e.path, e.button_pos, e.action_kind, e.auto_detected, e.session_id, e.occurred_at
           from events e where e.site_id = $1 and not e.is_test and e.type = 'click' and e.occurred_at between $2 and $3
       ), s as (
         select session_id, attributed_event_id from submissions where site_id = $1 and not is_test and receipt_status <> 'tentativa' and occurred_at between $2 and $3
       )
       select c.button_id as "buttonId", c.path, c.button_pos as pos, c.action_kind as kind, bool_or(c.auto_detected) as "autoDetected",
              count(*)::int as cliques,
              count(distinct c.session_id)::int as "sessoesComClique",
              count(s.attributed_event_id)::int as "contatosAtribuidos",
              count(distinct c.session_id) filter (where exists (select 1 from s s2 where s2.session_id = c.session_id))::int as "sessoesConvertidas",
              max(c.occurred_at) as "ultimoClique"
         from c left join s on s.attributed_event_id = c.id
        group by c.button_id, c.path, c.button_pos, c.action_kind
        order by cliques desc, c.path`,
      [siteId, p.de, p.ate],
    ),
  );
}

export type Horario = { hora: number; cliques: number; contatos: number; novosLeads: number; visualizacoes: number };
export type DiaSemana = { dia: number; cliques: number; contatos: number; visualizacoes: number };

/** Ações por hora do dia (0–23) no FUSO DO SITE. Contagens, não taxas. */
export async function porHora(accountId: string, siteId: string, fuso: string, p: Periodo): Promise<Horario[]> {
  const linhas = await comConta(accountId, (db) =>
    db.query<{ hora: number; cliques: number; visualizacoes: number; contatos: number; novos: number }>(
      `with e as (
         select extract(hour from occurred_at at time zone $4)::int as hora, type from events where site_id = $1 and not is_test and occurred_at between $2 and $3
       ), s as (
         select extract(hour from occurred_at at time zone $4)::int as hora, is_new_lead from submissions where site_id = $1 and not is_test and receipt_status <> 'tentativa' and occurred_at between $2 and $3
       ), h as (select generate_series(0, 23) as hora)
       select h.hora,
              (select count(*)::int from e where e.hora = h.hora and e.type = 'click') as cliques,
              (select count(*)::int from e where e.hora = h.hora and e.type = 'page_view') as visualizacoes,
              (select count(*)::int from s where s.hora = h.hora) as contatos,
              (select count(*)::int from s where s.hora = h.hora and s.is_new_lead) as novos
         from h order by h.hora`,
      [siteId, p.de, p.ate, fuso],
    ),
  );
  return linhas.map((l) => ({ hora: l.hora, cliques: l.cliques, contatos: l.contatos, novosLeads: l.novos, visualizacoes: l.visualizacoes }));
}

export async function porDiaDaSemana(accountId: string, siteId: string, fuso: string, p: Periodo): Promise<DiaSemana[]> {
  return comConta(accountId, (db) =>
    db.query<DiaSemana>(
      `with e as (
         select extract(dow from occurred_at at time zone $4)::int as dia, type from events where site_id = $1 and not is_test and occurred_at between $2 and $3
       ), s as (
         select extract(dow from occurred_at at time zone $4)::int as dia from submissions where site_id = $1 and not is_test and receipt_status <> 'tentativa' and occurred_at between $2 and $3
       ), d as (select generate_series(0, 6) as dia)
       select d.dia,
              (select count(*)::int from e where e.dia = d.dia and e.type = 'click') as cliques,
              (select count(*)::int from e where e.dia = d.dia and e.type = 'page_view') as visualizacoes,
              (select count(*)::int from s where s.dia = d.dia) as contatos
         from d order by d.dia`,
      [siteId, p.de, p.ate, fuso],
    ),
  );
}

export type Origem = { source: string; medium: string | null; sessoes: number; contatos: number };
export async function origens(accountId: string, siteId: string, p: Periodo): Promise<Origem[]> {
  return comConta(accountId, (db) =>
    db.query<Origem>(
      `select s.source, s.medium, count(distinct s.id)::int as sessoes,
              (select count(*)::int from submissions b where b.session_id = any(array_agg(s.id)) and not b.is_test and b.receipt_status <> 'tentativa' and b.occurred_at between $2 and $3) as contatos
         from sessions s where s.site_id = $1 and not s.is_test and s.started_at between $2 and $3
        group by s.source, s.medium order by sessoes desc limit 20`,
      [siteId, p.de, p.ate],
    ),
  );
}

export type Rastreamento = { collectPageviews: boolean; collectClicks: boolean; formMode: 'endpoint' | 'webhook' | 'auxiliar' | 'desligado'; allowedFields: string[]; collectMessage: boolean; consentMode: 'nenhum' | 'exigido'; defaultCountry: string; temWebhook: boolean };

export async function rastreamentoDoSite(accountId: string, siteId: string): Promise<Rastreamento> {
  const r = await comConta(accountId, (db) =>
    db.one<Rastreamento>(
      `select collect_pageviews as "collectPageviews", collect_clicks as "collectClicks", form_mode as "formMode", form_allowed_fields as "allowedFields",
              collect_message as "collectMessage", consent_mode as "consentMode", default_country as "defaultCountry", (webhook_secret_hash is not null) as "temWebhook"
         from site_tracking where site_id = $1`,
      [siteId],
    ),
  );
  return r ?? { collectPageviews: true, collectClicks: true, formMode: 'endpoint', allowedFields: ['name', 'email', 'phone'], collectMessage: false, consentMode: 'nenhum', defaultCountry: 'BR', temWebhook: false };
}

export type Diagnostico = { token: string; createdAt: Date; expiresAt: Date; evidence: Record<string, { at: string; path?: string }> };
export async function diagnosticoAtual(accountId: string, siteId: string): Promise<Diagnostico | null> {
  return comConta(accountId, (db) =>
    db.one<Diagnostico>(`select token, created_at as "createdAt", expires_at as "expiresAt", evidence from diagnostic_sessions where site_id = $1 and expires_at > now() order by created_at desc limit 1`, [siteId]),
  );
}

/** Eventos de teste recentes (para a prova de instalação). */
export async function eventosDeTeste(accountId: string, siteId: string, token: string): Promise<{ type: string; path: string; buttonId: string | null; occurredAt: Date }[]> {
  return comConta(accountId, (db) =>
    db.query(`select e.type, e.path, e.button_id as "buttonId", e.occurred_at as "occurredAt" from events e where e.site_id = $1 and e.is_test and e.received_at >= (select created_at from diagnostic_sessions where token = $2) order by e.occurred_at desc limit 20`, [siteId, token]),
  );
}
