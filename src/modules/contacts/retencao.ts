import type { Pool } from 'pg';
import type { Queryable } from '@/shared/db';

/**
 * Exclusão e retenção de contatos.
 *
 * Este módulo NÃO importa `server-only` nem o pool da central de propósito: a
 * mesma função roda na Server Action (dentro de `comConta`, com RLS) e no
 * worker (papel `app_worker`, com privilégio por coluna). Quem chama entrega a
 * transação; aqui só há SQL.
 *
 * Excluir é ANONIMIZAR, nunca apagar a linha:
 *   · identidades (e-mail, telefone) são removidas;
 *   · `contacts.name` vira null; `deleted_at`, `anonymized_at` e `deletion_reason` marcam o fato;
 *   · nos envios do contato, `fields` vira {} — `occurred_at`, `page_path`,
 *     `attribution`, `attributed_event_id` e `is_new_lead` ficam intactos, logo
 *     contagens e horários do relatório não mudam;
 *   · conflitos abertos que envolvem o contato fecham como 'contato_excluido'.
 *
 * O que NÃO é tocado: envios de OUTRO contato que, num conflito, carreguem o
 * mesmo telefone ou e-mail nos campos — são dados do outro contato até o
 * operador decidir —, e envios de diagnóstico (`is_test`, sem contato), que a
 * central nunca lista.
 */

export type MotivoDeExclusao = 'manual' | 'retencao';

export type ResultadoDaExclusao =
  | { excluido: true; identidades: number; submissoes: number; conflitos: number }
  | { excluido: false; motivo: 'nao_encontrado' | 'ja_anonimizado' };

export async function excluirContatoNoBanco(
  db: Queryable,
  entrada: { accountId: string; siteId: string; contactId: string; motivo: MotivoDeExclusao; agora?: Date },
): Promise<ResultadoDaExclusao> {
  const agora = entrada.agora ?? new Date();
  // Com RLS (central), um contato de outra conta é "nenhuma linha"; o filtro
  // por account_id e site_id vale também para o worker, que enxerga tudo.
  const c = await db.one<{ id: string; anonymized_at: Date | null }>(
    'select id, anonymized_at from contacts where id = $1 and site_id = $2 and account_id = $3',
    [entrada.contactId, entrada.siteId, entrada.accountId],
  );
  if (!c) return { excluido: false, motivo: 'nao_encontrado' };
  if (c.anonymized_at) return { excluido: false, motivo: 'ja_anonimizado' };

  const identidades = await db.query<{ id: string }>('delete from contact_identities where contact_id = $1 and site_id = $2 returning id', [c.id, entrada.siteId]);
  const submissoes = await db.query<{ id: string }>(`update submissions set fields = '{}'::jsonb where contact_id = $1 and site_id = $2 returning id`, [c.id, entrada.siteId]);
  const conflitos = await db.query<{ id: string }>(
    `update contact_conflicts set resolved_at = $3, resolution = 'contato_excluido'
      where site_id = $2 and resolved_at is null and (email_contact_id = $1 or phone_contact_id = $1) returning id`,
    [c.id, entrada.siteId, agora],
  );
  await db.query(
    `update contacts set name = null, deleted_at = coalesce(deleted_at, $2), anonymized_at = $2, deletion_reason = $3
      where id = $1 and site_id = $4`,
    [c.id, agora, entrada.motivo, entrada.siteId],
  );
  return { excluido: true, identidades: identidades.length, submissoes: submissoes.length, conflitos: conflitos.length };
}

// ───────────────────────── política por site ─────────────────────────

export type PoliticaDeRetencao = { policy: 'manual' | 'dias'; dias: number | null };

/** Política vigente do site. Sem linha em `site_tracking` vale o padrão: manual. */
export async function lerPoliticaDeRetencao(db: Queryable, siteId: string): Promise<PoliticaDeRetencao> {
  const r = await db.one<PoliticaDeRetencao>(
    'select contact_retention_policy as policy, contact_retention_days as dias from site_tracking where site_id = $1',
    [siteId],
  );
  return r ?? { policy: 'manual', dias: null };
}

/** Validação pura da política, compartilhada pela ação e pelos testes. */
export function validarPolitica(policy: string, dias: string | number | null): { ok: true; valor: PoliticaDeRetencao } | { ok: false; erro: string } {
  if (policy === 'manual') return { ok: true, valor: { policy: 'manual', dias: null } };
  if (policy !== 'dias') return { ok: false, erro: 'Política desconhecida.' };
  const n = typeof dias === 'number' ? dias : Number(String(dias ?? '').trim());
  if (!Number.isInteger(n) || n < 30 || n > 3650) return { ok: false, erro: 'Para a política automática, informe um prazo entre 30 e 3650 dias.' };
  return { ok: true, valor: { policy: 'dias', dias: n } };
}

// ───────────────────────── varredura do worker ─────────────────────────

export type ResumoDaRetencao = { candidatos: number; anonimizados: number; erros: number };

/**
 * Retenção automática. Para cada site com política 'dias', anonimiza os
 * contatos cujo último contato real é anterior a `agora - dias` e que ainda não
 * foram anonimizados, com motivo 'retencao'. Uma transação por contato: um erro
 * isolado não desfaz os demais. Idempotente: a segunda passada não encontra nada.
 *
 * Assinatura para o worker (`DATABASE_URL_WORKER`, papel app_worker):
 *   const r = await aplicarRetencao(pool);   // { candidatos, anonimizados, erros }
 * Sugestão: no bloco de retenção horária de `worker/index.ts`, ao lado de `retencao(pool)`.
 */
export async function aplicarRetencao(pool: Pool, agora: Date = new Date(), limite = 500): Promise<ResumoDaRetencao> {
  const candidatos = await pool.query<{ id: string; account_id: string; site_id: string }>(
    `select c.id, c.account_id, c.site_id
       from contacts c
       join site_tracking t on t.site_id = c.site_id
      where t.contact_retention_policy = 'dias'
        and c.anonymized_at is null
        and coalesce(c.last_real_at, c.created_at) < $1::timestamptz - make_interval(days => t.contact_retention_days)
      order by coalesce(c.last_real_at, c.created_at)
      limit $2`,
    [agora, limite],
  );
  const resumo: ResumoDaRetencao = { candidatos: candidatos.rowCount ?? 0, anonimizados: 0, erros: 0 };
  for (const c of candidatos.rows) {
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const db: Queryable = {
        query: async (sql, params = []) => (await cliente.query(sql, params)).rows,
        one: async (sql, params = []) => (await cliente.query(sql, params)).rows[0] ?? null,
      };
      const r = await excluirContatoNoBanco(db, { accountId: c.account_id, siteId: c.site_id, contactId: c.id, motivo: 'retencao', agora });
      await cliente.query('commit');
      if (r.excluido) resumo.anonimizados += 1;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      resumo.erros += 1;
      console.error(`[retenção] contato ${c.id} não anonimizado:`, e instanceof Error ? e.message : e);
    } finally {
      cliente.release();
    }
  }
  return resumo;
}
