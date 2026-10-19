'use server';

import { revalidatePath } from 'next/cache';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';

const UUID = /^[0-9a-f-]{36}$/i;
const COOLDOWN_MANUAL_MS = 2 * 60 * 1000;

function texto(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
}

/** Pausa ou retoma o monitor. Retomar agenda a próxima checagem para agora. */
export async function pausarOuRetomar(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  const retomar = texto(fd, 'retomar') === '1';
  if (!UUID.test(siteId)) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query(
      `update monitors set enabled = $2, next_check_at = case when $2 then now() else next_check_at end where site_id = $1 returning id`,
      [siteId, retomar],
    );
    if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: retomar ? 'monitor.retomar' : 'monitor.pausar', alvoTipo: 'site', alvoId: siteId });
  });
  revalidatePath(`/sites/${siteId}`);
  revalidatePath(`/sites/${siteId}/disponibilidade`);
  revalidatePath('/sites');
}

/** Janela de manutenção em horas (0 encerra). Checagens continuam; alertas operacionais são suprimidos. */
export async function definirManutencao(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  const horas = Number(texto(fd, 'horas'));
  if (!UUID.test(siteId) || !Number.isFinite(horas) || horas < 0 || horas > 24 * 14) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query(
      `update monitors set maintenance_until = case when $2 > 0 then now() + make_interval(hours => $2) else null end where site_id = $1 returning id`,
      [siteId, horas],
    );
    if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'monitor.manutencao', alvoTipo: 'site', alvoId: siteId, detalhes: { horas } });
  });
  revalidatePath(`/sites/${siteId}`);
  revalidatePath(`/sites/${siteId}/disponibilidade`);
  revalidatePath('/sites');
}

/**
 * Verificação manual: só ENFILEIRA (next_check_at = agora), com cooldown de
 * dois minutos. Não aceita destino arbitrário: a URL é a do monitor.
 */
export async function verificarAgora(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query(
      `update monitors set next_check_at = now(), manual_requested_at = now()
        where site_id = $1 and enabled
          and (manual_requested_at is null or manual_requested_at < now() - make_interval(secs => $2))
        returning id`,
      [siteId, COOLDOWN_MANUAL_MS / 1000],
    );
    if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'monitor.verificar_agora', alvoTipo: 'site', alvoId: siteId });
  });
  revalidatePath(`/sites/${siteId}/disponibilidade`);
}

export async function resolverAlerta(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  const silenciar = texto(fd, 'silenciar') === '1';
  if (!UUID.test(id)) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query(
      `update alerts set state = $2, resolved_at = now(), resolved_by = $3 where id = $1 and state = 'aberto' returning site_id`,
      [id, silenciar ? 'silenciado' : 'resolvido', u.email],
    );
    if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: silenciar ? 'alerta.silenciar' : 'alerta.resolver', alvoTipo: 'alert', alvoId: id });
  });
  revalidatePath('/atencao');
  revalidatePath('/sites');
}
