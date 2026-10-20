'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';
import { hashDoSegredo } from '@/modules/contacts/recepcao';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

const UUID = /^[0-9a-f-]{36}$/i;
const texto = (fd: FormData, n: string) => { const v = fd.get(n); return typeof v === 'string' ? v : ''; };
const CAMPOS = ['name', 'email', 'phone', 'message', 'company', 'subject'] as const;

export async function salvarRastreamento(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return { erro: 'Site inválido.' };
  const formMode = texto(fd, 'form_mode');
  if (!['endpoint', 'webhook', 'auxiliar', 'desligado'].includes(formMode)) return { erro: 'Modo de formulário inválido.' };
  const consent = texto(fd, 'consent_mode') === 'exigido' ? 'exigido' : 'nenhum';
  const campos = CAMPOS.filter((c) => fd.get(`campo_${c}`) === '1');
  if (!campos.includes('email') && !campos.includes('phone')) return { erro: 'E-mail ou telefone precisa estar entre os campos permitidos.' };
  const pais = texto(fd, 'pais').toUpperCase();
  await comConta(u.accountId, async (db) => {
    await db.query(
      `insert into site_tracking (site_id, account_id, collect_pageviews, collect_clicks, form_mode, form_allowed_fields, collect_message, consent_mode, default_country)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (site_id) do update set collect_pageviews = $3, collect_clicks = $4, form_mode = $5, form_allowed_fields = $6, collect_message = $7, consent_mode = $8, default_country = $9, updated_at = now()`,
      [siteId, u.accountId, fd.get('pageviews') === '1', fd.get('clicks') === '1', formMode, campos, fd.get('mensagem') === '1' && campos.includes('message'), consent, /^[A-Z]{2}$/.test(pais) ? pais : 'BR'],
    );
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'rastreamento.salvar', alvoTipo: 'site', alvoId: siteId, detalhes: { formMode, campos, consent } });
  });
  revalidatePath(`/sites/${siteId}/instalacao`);
  return { ok: true, mensagem: 'Configuração salva. Ela vale para o coletor e para o endpoint a partir de agora.' };
}

/** Gera (ou troca) o segredo do webhook. Mostrado UMA vez; só o hash fica no banco. */
export async function gerarSegredoWebhook(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return;
  const segredo = `jw_whs_${randomBytes(24).toString('base64url')}`;
  await comConta(u.accountId, async (db) => {
    await db.query(`insert into site_tracking (site_id, account_id, webhook_secret_hash) values ($1, $2, $3) on conflict (site_id) do update set webhook_secret_hash = $3, updated_at = now()`, [siteId, u.accountId, hashDoSegredo(segredo)]);
    // O segredo em claro vai para a sessão de diagnóstico corrente como "mostrar uma vez".
    await db.query(`insert into diagnostic_sessions (account_id, site_id, token, expires_at, evidence) values ($1, $2, $3, now() + interval '10 minutes', $4)`, [u.accountId, siteId, `show-${randomBytes(12).toString('base64url')}`, JSON.stringify({ webhook_secret_once: segredo })]);
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'webhook.segredo', alvoTipo: 'site', alvoId: siteId });
  });
  revalidatePath(`/sites/${siteId}/instalacao`);
}

/** Token de diagnóstico com validade de 1 h: tudo o que ele marcar fica fora dos KPIs. */
export async function iniciarDiagnostico(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return;
  await comConta(u.accountId, async (db) => {
    await db.query(`insert into diagnostic_sessions (account_id, site_id, token, expires_at) values ($1, $2, $3, now() + interval '1 hour')`, [u.accountId, siteId, `diag-${randomBytes(12).toString('base64url')}`]);
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'diagnostico.iniciar', alvoTipo: 'site', alvoId: siteId });
  });
  revalidatePath(`/sites/${siteId}/instalacao`);
}

export async function resolverConflito(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id'); const siteId = texto(fd, 'site'); const decisao = texto(fd, 'decisao');
  if (!UUID.test(id) || !UUID.test(siteId) || !['mesma_pessoa', 'pessoas_diferentes'].includes(decisao)) return;
  await comConta(u.accountId, async (db) => {
    const k = await db.one<{ email_contact_id: string; phone_contact_id: string }>('select email_contact_id, phone_contact_id from contact_conflicts where id = $1 and resolved_at is null', [id]);
    if (!k) return;
    if (decisao === 'mesma_pessoa') {
      // Mescla explícita e auditada: identidades e submissões de B passam para A; B é marcado como removido.
      await db.query('update contact_identities set contact_id = $1 where contact_id = $2', [k.email_contact_id, k.phone_contact_id]);
      await db.query('update submissions set contact_id = $1 where contact_id = $2', [k.email_contact_id, k.phone_contact_id]);
      await db.query('update contacts a set first_real_at = least(a.first_real_at, b.first_real_at), last_real_at = greatest(a.last_real_at, b.last_real_at) from contacts b where a.id = $1 and b.id = $2', [k.email_contact_id, k.phone_contact_id]);
      await db.query('update contacts set deleted_at = now() where id = $1', [k.phone_contact_id]);
    }
    await db.query('update contact_conflicts set resolved_at = now(), resolution = $2 where id = $1', [id, decisao]);
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'conflito.resolver', alvoTipo: 'contact_conflict', alvoId: id, detalhes: { decisao } });
  });
  revalidatePath(`/sites/${siteId}/contatos`);
}
