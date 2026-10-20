import 'server-only';
import { comConta } from '@/shared/db';

export type ContatoResumo = { id: string; name: string | null; email: string | null; phone: string | null; firstRealAt: Date | null; lastRealAt: Date | null; submissoes: number; conflitos: number };

export async function listarContatos(accountId: string, siteId: string, opcoes: { busca?: string; limite?: number } = {}): Promise<ContatoResumo[]> {
  return comConta(accountId, (db) =>
    db.query<ContatoResumo>(
      `select c.id, c.name, 
              (select value from contact_identities i where i.contact_id = c.id and i.kind = 'email' order by created_at limit 1) as email,
              (select value from contact_identities i where i.contact_id = c.id and i.kind = 'phone' order by created_at limit 1) as phone,
              c.first_real_at as "firstRealAt", c.last_real_at as "lastRealAt",
              (select count(*)::int from submissions s where s.contact_id = c.id and not s.is_test) as submissoes,
              (select count(*)::int from contact_conflicts k where (k.email_contact_id = c.id or k.phone_contact_id = c.id) and k.resolved_at is null) as conflitos
         from contacts c
        where c.site_id = $1 and c.deleted_at is null
          and ($2::text is null or c.name ilike '%' || $2 || '%' or exists (select 1 from contact_identities i where i.contact_id = c.id and i.value ilike '%' || $2 || '%'))
        order by c.last_real_at desc nulls last limit $3`,
      [siteId, opcoes.busca?.trim() || null, opcoes.limite ?? 200],
    ),
  );
}

export type SubmissaoResumo = { id: string; occurredAt: Date; receiptStatus: string; mode: string; evidenceSource: string; pagePath: string | null; attribution: string; botao: string | null; isNewLead: boolean; fields: Record<string, string>; contactId: string | null; contactName: string | null };

export async function listarSubmissoes(accountId: string, siteId: string, opcoes: { contactId?: string; de?: Date; ate?: Date; limite?: number } = {}): Promise<SubmissaoResumo[]> {
  return comConta(accountId, (db) =>
    db.query<SubmissaoResumo>(
      `select s.id, s.occurred_at as "occurredAt", s.receipt_status as "receiptStatus", s.mode, s.evidence_source as "evidenceSource", s.page_path as "pagePath",
              s.attribution, e.button_id as botao, s.is_new_lead as "isNewLead", s.fields, s.contact_id as "contactId", c.name as "contactName"
         from submissions s left join events e on e.id = s.attributed_event_id left join contacts c on c.id = s.contact_id
        where s.site_id = $1 and not s.is_test
          and ($2::uuid is null or s.contact_id = $2)
          and ($3::timestamptz is null or s.occurred_at >= $3) and ($4::timestamptz is null or s.occurred_at <= $4)
        order by s.occurred_at desc limit $5`,
      [siteId, opcoes.contactId ?? null, opcoes.de ?? null, opcoes.ate ?? null, opcoes.limite ?? 200],
    ),
  );
}

export type Conflito = { id: string; createdAt: Date; emailContactId: string; phoneContactId: string; emailNome: string | null; phoneNome: string | null; email: string | null; phone: string | null };
export async function conflitosAbertos(accountId: string, siteId: string): Promise<Conflito[]> {
  return comConta(accountId, (db) =>
    db.query<Conflito>(
      `select k.id, k.created_at as "createdAt", k.email_contact_id as "emailContactId", k.phone_contact_id as "phoneContactId",
              a.name as "emailNome", b.name as "phoneNome", s.fields->>'email' as email, s.fields->>'phone' as phone
         from contact_conflicts k join contacts a on a.id = k.email_contact_id join contacts b on b.id = k.phone_contact_id join submissions s on s.id = k.submission_id
        where k.site_id = $1 and k.resolved_at is null order by k.created_at desc`,
      [siteId],
    ),
  );
}

export const ROTULO_RECEBIMENTO: Record<string, { texto: string; tom: 'ok' | 'warn' | 'neg' | 'soft' }> = {
  recebido: { texto: 'Contato recebido', tom: 'ok' },
  confirmado_destino: { texto: 'Destino confirmado', tom: 'ok' },
  falha_destino: { texto: 'Falha no destino original', tom: 'neg' },
  tentativa: { texto: 'Tentativa (sem dados)', tom: 'soft' },
};
