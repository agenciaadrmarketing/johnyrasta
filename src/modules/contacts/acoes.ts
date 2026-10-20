'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';
import { excluirContatoNoBanco, validarPolitica } from '@/modules/contacts/retencao';

/**
 * Server Actions de contatos: exige sessão → valida → grava em `comConta`
 * (RLS) → audita → revalida. Um id de outra conta vira "nenhuma linha" e a
 * ação termina em silêncio, como se o registro não existisse.
 *
 * A trilha de auditoria recebe só contagens — nunca nome, e-mail ou telefone.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const texto = (fd: FormData, n: string) => { const v = fd.get(n); return typeof v === 'string' ? v : ''; };

/** Exclui (anonimiza) um contato. Form POST: `site`, `id`. */
export async function excluirContato(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  const contactId = texto(fd, 'id');
  if (!UUID.test(siteId) || !UUID.test(contactId)) return;
  const r = await comConta(u.accountId, async (db) => {
    const resultado = await excluirContatoNoBanco(db, { accountId: u.accountId, siteId, contactId, motivo: 'manual' });
    if (resultado.excluido) {
      await auditar(db, {
        accountId: u.accountId, userId: u.userId, acao: 'contato.excluir', alvoTipo: 'contact', alvoId: contactId,
        detalhes: { motivo: 'manual', identidades: resultado.identidades, submissoes: resultado.submissoes, conflitos: resultado.conflitos },
      });
    }
    return resultado;
  });
  if (!r.excluido) return;
  revalidatePath(`/sites/${siteId}/contatos`);
  redirect(`/sites/${siteId}/contatos?aviso=excluido`);
}

/** Salva a política de retenção do site. Form POST: `site`, `policy` ('manual' | 'dias'), `dias`. */
export async function salvarRetencao(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return;
  const v = validarPolitica(texto(fd, 'policy'), texto(fd, 'dias'));
  if (!v.ok) redirect(`/sites/${siteId}/contatos?aviso=retencao_invalida`);
  const gravou = await comConta(u.accountId, async (db) => {
    // Site de outra conta: a RLS não devolve linha e nada é gravado (nem tentado).
    const site = await db.one<{ id: string }>('select id from sites where id = $1', [siteId]);
    if (!site) return false;
    await db.query(
      `insert into site_tracking (site_id, account_id, contact_retention_policy, contact_retention_days)
       values ($1, $2, $3, $4)
       on conflict (site_id) do update set contact_retention_policy = $3, contact_retention_days = $4, updated_at = now()`,
      [siteId, u.accountId, v.valor.policy, v.valor.dias],
    );
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'retencao.salvar', alvoTipo: 'site', alvoId: siteId, detalhes: { policy: v.valor.policy, dias: v.valor.dias } });
    return true;
  });
  if (!gravou) return;
  revalidatePath(`/sites/${siteId}/contatos`);
  redirect(`/sites/${siteId}/contatos?aviso=retencao_salva`);
}
