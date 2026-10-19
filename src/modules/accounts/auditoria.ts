import 'server-only';
import type { Queryable } from '@/shared/db';

/** Registra uma operação administrativa. Nunca recebe senha, token ou corpo de formulário. */
export async function auditar(
  db: Queryable,
  entrada: { accountId: string; userId: string; acao: string; alvoTipo: string; alvoId?: string; detalhes?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `insert into audit_log (account_id, user_id, action, target_type, target_id, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [entrada.accountId, entrada.userId, entrada.acao, entrada.alvoTipo, entrada.alvoId ?? null, JSON.stringify(entrada.detalhes ?? {})],
  );
}
