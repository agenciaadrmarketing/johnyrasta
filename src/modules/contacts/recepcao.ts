import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '@/shared/db';
import { filtrarCampos, identificadores } from '@/modules/contacts/identidade';
import { escolherCliqueAtribuido, normalizarPath } from '@/modules/analytics/regras';

export type SiteParaFormulario = {
  id: string; accountId: string; domain: string; formMode: 'endpoint' | 'webhook' | 'auxiliar' | 'desligado';
  allowedFields: string[]; collectMessage: boolean; defaultCountry: string; webhookSecretHash: string | null;
};

export async function siteDeFormulario(db: Queryable, publicId: string): Promise<SiteParaFormulario | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(publicId)) return null;
  return db.one<SiteParaFormulario>(
    `select s.id, s.account_id as "accountId", s.domain, coalesce(t.form_mode, 'endpoint') as "formMode",
            coalesce(t.form_allowed_fields, array['name','email','phone']) as "allowedFields", coalesce(t.collect_message, false) as "collectMessage",
            coalesce(t.default_country, 'BR') as "defaultCountry", t.webhook_secret_hash as "webhookSecretHash"
       from sites s left join site_tracking t on t.site_id = s.id where s.public_id = $1 and s.archived_at is null`,
    [publicId],
  );
}

export type EntradaDeSubmissao = {
  submission_id: string;
  fields: Record<string, unknown>;
  page_path?: string | null;
  session_key?: string | null;
  occurred_at?: string | null;
  test_token?: string | null;
  /** Só no modo auxiliar: o site informa o que aconteceu no destino original. */
  destination_status?: 'ok' | 'failed' | 'unknown' | null;
  honeypot?: string | null;
};

export type ResultadoDaSubmissao =
  | { ok: true; status: 'recebido' | 'falha_destino' | 'tentativa' | 'confirmado_destino'; submissionId: string; duplicado: boolean; contactId: string | null; attribution: 'ultimo_clique' | 'sem_atribuicao' }
  | { ok: false; motivo: string; codigo: 400 | 403 | 422 };

const ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Recebe uma submissão. Idempotente por (site, submission_id): reenvio devolve
 * o MESMO resultado lógico sem criar segundo registro (F01). O modo decide o
 * status: endpoint = recebido; auxiliar = recebido com destino desconhecido,
 * ou falha_destino se o site disse que falhou — NUNCA confirmado (F02).
 * Eventos de diagnóstico não tocam em contatos nem em "novo lead" (F04).
 */
export async function receberSubmissao(db: Queryable, site: SiteParaFormulario, entrada: EntradaDeSubmissao, modo: 'endpoint' | 'auxiliar', agora: Date): Promise<ResultadoDaSubmissao> {
  if (site.formMode === 'desligado') return { ok: false, motivo: 'recebimento de formulários desligado para este site', codigo: 403 };
  if (typeof entrada.submission_id !== 'string' || !ID.test(entrada.submission_id)) return { ok: false, motivo: 'submission_id inválido', codigo: 400 };
  if (entrada.honeypot) return { ok: false, motivo: 'rejeitado', codigo: 422 };
  const campos = filtrarCampos(entrada.fields ?? {}, site.allowedFields, site.collectMessage);
  const ids = identificadores(campos, site.defaultCountry);
  if (!ids.valido) return { ok: false, motivo: 'é preciso ao menos um contato válido (e-mail ou telefone)', codigo: 422 };

  const existente = await db.one<{ id: string; receipt_status: ResultadoDaSubmissao extends { status: infer S } ? S : never; contact_id: string | null; attribution: 'ultimo_clique' | 'sem_atribuicao' }>(
    'select id, receipt_status, contact_id, attribution from submissions where site_id = $1 and submission_id = $2',
    [site.id, entrada.submission_id],
  );
  if (existente) return { ok: true, status: existente.receipt_status as 'recebido', submissionId: existente.id, duplicado: true, contactId: existente.contact_id, attribution: existente.attribution };

  const ocorrido = entrada.occurred_at ? new Date(entrada.occurred_at) : agora;
  const quando = Number.isNaN(ocorrido.getTime()) || Math.abs(agora.getTime() - ocorrido.getTime()) > 60 * 60 * 1000 ? agora : ocorrido;
  const diag = entrada.test_token ? await db.one('select 1 from diagnostic_sessions where site_id = $1 and token = $2 and expires_at > now()', [site.id, entrada.test_token]) : null;
  const isTest = !!diag;

  // Sessão e atribuição.
  let sessionId: string | null = null;
  let atribuido: { id: number } | null = null;
  if (entrada.session_key && /^[A-Za-z0-9_-]{8,64}$/.test(entrada.session_key)) {
    const s = await db.one<{ id: string }>('select id from sessions where site_id = $1 and session_key = $2', [site.id, entrada.session_key]);
    if (s) {
      sessionId = s.id;
      const cliques = await db.query<{ id: number; occurred_at: Date; type: string }>(
        `select id, occurred_at, type from events where session_id = $1 and type = 'click' and occurred_at <= $2 and occurred_at >= $2::timestamptz - interval '30 minutes' order by occurred_at desc limit 20`,
        [s.id, quando],
      );
      const e = escolherCliqueAtribuido(cliques.map((c) => ({ ...c, occurredAt: c.occurred_at })), quando);
      atribuido = e ? { id: e.id } : null;
    }
  }

  // Contato (só fora de diagnóstico).
  let contactId: string | null = null;
  let novoLead = false;
  let conflito: { email: string; phone: string } | null = null;
  if (!isTest) {
    const porEmail = ids.email ? await db.one<{ contact_id: string }>('select contact_id from contact_identities where site_id = $1 and kind = $2 and value = $3', [site.id, 'email', ids.email]) : null;
    const porPhone = ids.phone ? await db.one<{ contact_id: string }>('select contact_id from contact_identities where site_id = $1 and kind = $2 and value = $3', [site.id, 'phone', ids.phone]) : null;
    if (porEmail && porPhone && porEmail.contact_id !== porPhone.contact_id) {
      // F03: conflito explícito; a submissão fica com o contato do e-mail, sem mesclar.
      contactId = porEmail.contact_id;
      conflito = { email: porEmail.contact_id, phone: porPhone.contact_id };
    } else if (porEmail || porPhone) {
      contactId = (porEmail ?? porPhone)!.contact_id;
    } else {
      const c = await db.one<{ id: string }>('insert into contacts (account_id, site_id, name, first_real_at, last_real_at) values ($1, $2, $3, $4, $4) returning id', [site.accountId, site.id, campos.name ?? null, quando]);
      contactId = c!.id;
      novoLead = true;
    }
    if (!novoLead) {
      await db.query('update contacts set last_real_at = greatest(coalesce(last_real_at, $2), $2), first_real_at = least(coalesce(first_real_at, $2), $2), name = coalesce(name, $3) where id = $1', [contactId, quando, campos.name ?? null]);
    }
    // Identidades novas ligam ao contato escolhido (sem conflito).
    if (!conflito) {
      for (const [kind, value] of [['email', ids.email], ['phone', ids.phone]] as const) {
        if (value) await db.query('insert into contact_identities (account_id, site_id, contact_id, kind, value) values ($1, $2, $3, $4, $5) on conflict (site_id, kind, value) do nothing', [site.accountId, site.id, contactId, kind, value]);
      }
    }
  }

  const status = modo === 'endpoint' ? 'recebido' : entrada.destination_status === 'failed' ? 'falha_destino' : 'recebido';
  const evidencia = modo === 'endpoint' ? 'endpoint da central' : `cópia do coletor · destino: ${entrada.destination_status ?? 'desconhecido'}`;
  const sub = await db.one<{ id: string }>(
    `insert into submissions (account_id, site_id, submission_id, mode, receipt_status, evidence_source, page_path, session_key, session_id, contact_id, fields, attributed_event_id, attribution, is_test, is_new_lead, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (site_id, submission_id) do nothing returning id`,
    [site.accountId, site.id, entrada.submission_id, modo, status, evidencia, entrada.page_path ? normalizarPath(entrada.page_path) : null, entrada.session_key ?? null, sessionId, contactId,
     JSON.stringify(campos), atribuido?.id ?? null, atribuido ? 'ultimo_clique' : 'sem_atribuicao', isTest, novoLead, quando],
  );
  if (!sub) {
    // Corrida com um reenvio simultâneo: devolve o registro vencedor.
    const v = await db.one<{ id: string; receipt_status: string; contact_id: string | null; attribution: 'ultimo_clique' | 'sem_atribuicao' }>('select id, receipt_status, contact_id, attribution from submissions where site_id = $1 and submission_id = $2', [site.id, entrada.submission_id]);
    return { ok: true, status: v!.receipt_status as 'recebido', submissionId: v!.id, duplicado: true, contactId: v!.contact_id, attribution: v!.attribution };
  }
  if (conflito) {
    await db.query('insert into contact_conflicts (account_id, site_id, submission_id, email_contact_id, phone_contact_id) values ($1, $2, $3, $4, $5)', [site.accountId, site.id, sub.id, conflito.email, conflito.phone]);
  }
  if (isTest && diag) {
    await db.query(`update diagnostic_sessions set evidence = evidence || jsonb_build_object('form', jsonb_build_object('at', $2::timestamptz)) where site_id = $1 and token = $3`, [site.id, quando, entrada.test_token]);
  }
  return { ok: true, status, submissionId: sub.id, duplicado: false, contactId, attribution: atribuido ? 'ultimo_clique' : 'sem_atribuicao' };
}

// ───────────────────────── webhook assinado (modo "destino confirma") ─────────────────────────

export function hashDoSegredo(segredo: string): string {
  return createHash('sha256').update(segredo).digest('hex');
}

export function assinar(segredo: string, timestamp: string, nonce: string, corpo: string): string {
  return createHmac('sha256', segredo).update(`${timestamp}.${nonce}.${corpo}`).digest('hex');
}

/**
 * Confirmação pelo destino original. Exige segredo do site (HMAC do corpo com
 * timestamp e nonce), janela de 5 min e nonce inédito (replay). Marca a
 * submissão como confirmada no destino — a única forma de chegar a esse status.
 */
export async function confirmarPeloDestino(
  db: Queryable, site: SiteParaFormulario, segredoInformado: string | null,
  cab: { timestamp: string | null; nonce: string | null; assinatura: string | null }, corpoBruto: string, agora: Date,
): Promise<{ ok: true; submissionId: string; criado: boolean } | { ok: false; motivo: string; codigo: 400 | 401 | 404 | 409 }> {
  if (!site.webhookSecretHash) return { ok: false, motivo: 'webhook não configurado para este site', codigo: 401 };
  if (!cab.timestamp || !cab.nonce || !cab.assinatura || !segredoInformado) return { ok: false, motivo: 'cabeçalhos de assinatura ausentes', codigo: 401 };
  if (hashDoSegredo(segredoInformado) !== site.webhookSecretHash) return { ok: false, motivo: 'segredo inválido', codigo: 401 };
  const ts = Number(cab.timestamp);
  if (!Number.isFinite(ts) || Math.abs(agora.getTime() / 1000 - ts) > 300) return { ok: false, motivo: 'timestamp fora da janela', codigo: 401 };
  const esperado = Buffer.from(assinar(segredoInformado, cab.timestamp, cab.nonce, corpoBruto));
  const recebido = Buffer.from(cab.assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { ok: false, motivo: 'assinatura inválida', codigo: 401 };
  const nonce = await db.query('insert into webhook_nonces (site_id, nonce) values ($1, $2) on conflict do nothing returning nonce', [site.id, cab.nonce.slice(0, 128)]);
  if (!nonce.length) return { ok: false, motivo: 'replay: nonce já usado', codigo: 409 };
  await db.query("delete from webhook_nonces where seen_at < now() - interval '1 day'");

  let corpo: EntradaDeSubmissao;
  try {
    corpo = JSON.parse(corpoBruto) as EntradaDeSubmissao;
  } catch {
    return { ok: false, motivo: 'corpo não é JSON', codigo: 400 };
  }
  // Pode confirmar uma submissão já recebida (mesmo submission_id) ou criar uma nova já confirmada.
  const r = await receberSubmissao(db, site, corpo, 'endpoint', agora);
  if (!r.ok) return { ok: false, motivo: r.motivo, codigo: 400 };
  await db.query(`update submissions set receipt_status = 'confirmado_destino', mode = 'webhook', evidence_source = 'confirmação assinada do destino' where id = $1 and is_test = false`, [r.submissionId]);
  return { ok: true, submissionId: r.submissionId, criado: !r.duplicado };
}
