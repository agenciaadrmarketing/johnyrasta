'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';
import { validarCliente, validarSite } from '@/shared/validation/site';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

/**
 * Server Actions da carteira.
 *
 * Toda ação: exige sessão → valida → grava dentro de `comConta` (RLS) → audita
 * → revalida. Um id de outra conta vira "nenhuma linha", e a ação responde
 * como se o registro não existisse.
 */

function texto(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
}

const UUID = /^[0-9a-f-]{36}$/i;

function erroDeUnicidade(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : '';
  if (msg.includes('sites_account_domain_key')) return 'Já existe um site ativo com este domínio na sua conta.';
  if (msg.includes('clients_account_name_key')) return 'Já existe um cliente com este nome.';
  return null;
}

// ───────────────────────── clientes ─────────────────────────

export async function criarCliente(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const v = validarCliente({ nome: texto(fd, 'nome'), notas: texto(fd, 'notas') });
  if (!v.ok) return { erro: 'Confira os campos.', campos: v.erros };
  let id: string;
  try {
    id = await comConta(u.accountId, async (db) => {
      const r = await db.one<{ id: string }>(
        'insert into clients (account_id, name, notes) values ($1, $2, $3) returning id',
        [u.accountId, v.valor.nome, v.valor.notas],
      );
      await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'cliente.criar', alvoTipo: 'client', alvoId: r!.id });
      return r!.id;
    });
  } catch (e) {
    const msg = erroDeUnicidade(e);
    if (msg) return { erro: msg, campos: { nome: msg } };
    throw e;
  }
  revalidatePath('/clientes');
  const destino = texto(fd, 'depois');
  redirect(destino === 'site' ? `/sites/novo?cliente=${id}` : `/clientes/${id}`);
}

export async function editarCliente(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return { erro: 'Cliente inválido.' };
  const v = validarCliente({ nome: texto(fd, 'nome'), notas: texto(fd, 'notas') });
  if (!v.ok) return { erro: 'Confira os campos.', campos: v.erros };
  try {
    const n = await comConta(u.accountId, async (db) => {
      const r = await db.query('update clients set name = $2, notes = $3 where id = $1 returning id', [id, v.valor.nome, v.valor.notas]);
      if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'cliente.editar', alvoTipo: 'client', alvoId: id });
      return r.length;
    });
    if (!n) return { erro: 'Cliente não encontrado.' };
  } catch (e) {
    const msg = erroDeUnicidade(e);
    if (msg) return { erro: msg, campos: { nome: msg } };
    throw e;
  }
  revalidatePath('/clientes');
  revalidatePath(`/clientes/${id}`);
  return { ok: true, mensagem: 'Cliente atualizado.' };
}

export async function arquivarCliente(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  const desarquivar = texto(fd, 'desarquivar') === '1';
  if (!UUID.test(id)) return;
  await comConta(u.accountId, async (db) => {
    if (!desarquivar) {
      const ativos = await db.one<{ n: number }>('select count(*)::int as n from sites where client_id = $1 and archived_at is null', [id]);
      // Cliente com sites ativos não arquiva: os sites ficariam órfãos na central.
      if ((ativos?.n ?? 0) > 0) return;
    }
    await db.query('update clients set archived_at = $2 where id = $1', [id, desarquivar ? null : new Date()]);
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: desarquivar ? 'cliente.desarquivar' : 'cliente.arquivar', alvoTipo: 'client', alvoId: id });
  });
  revalidatePath('/clientes');
  revalidatePath(`/clientes/${id}`);
}

// ───────────────────────── sites ─────────────────────────

function lerSite(fd: FormData) {
  return validarSite({
    nome: texto(fd, 'nome'),
    url: texto(fd, 'url'),
    fuso: texto(fd, 'fuso'),
    plataforma: texto(fd, 'plataforma'),
    clienteId: texto(fd, 'cliente'),
  });
}

export async function criarSite(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const v = lerSite(fd);
  if (!v.ok) return { erro: 'Confira os campos.', campos: v.erros as Record<string, string> };
  const monitorar = texto(fd, 'monitorar') === '1';
  const notas = texto(fd, 'notas').trim().slice(0, 2000) || null;
  let id: string;
  try {
    id = await comConta(u.accountId, async (db) => {
      const cliente = await db.one<{ id: string }>('select id from clients where id = $1 and archived_at is null', [v.valor.clienteId]);
      if (!cliente) throw new Error('cliente_invalido');
      const r = await db.one<{ id: string }>(
        `insert into sites (account_id, client_id, name, domain, primary_url, timezone, platform, public_id, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [u.accountId, v.valor.clienteId, v.valor.nome, v.valor.domain, v.valor.url, v.valor.fuso, v.valor.plataforma, randomBytes(9).toString('base64url'), notas],
      );
      if (monitorar) {
        await db.query(
          `insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, now())`,
          [u.accountId, r!.id, v.valor.url],
        );
      }
      await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'site.criar', alvoTipo: 'site', alvoId: r!.id, detalhes: { domain: v.valor.domain, monitorar } });
      return r!.id;
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'cliente_invalido') return { erro: 'Escolha um cliente ativo.', campos: { cliente: 'Cliente não encontrado.' } };
    const msg = erroDeUnicidade(e);
    if (msg) return { erro: msg, campos: { url: msg } };
    throw e;
  }
  revalidatePath('/sites');
  redirect(`/sites/${id}`);
}

export async function editarSite(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return { erro: 'Site inválido.' };
  const v = lerSite(fd);
  if (!v.ok) return { erro: 'Confira os campos.', campos: v.erros as Record<string, string> };
  const monitorar = texto(fd, 'monitorar') === '1';
  const notas = texto(fd, 'notas').trim().slice(0, 2000) || null;
  try {
    const n = await comConta(u.accountId, async (db) => {
      const cliente = await db.one<{ id: string }>('select id from clients where id = $1 and archived_at is null', [v.valor.clienteId]);
      if (!cliente) throw new Error('cliente_invalido');
      const r = await db.query(
        `update sites set client_id = $2, name = $3, domain = $4, primary_url = $5, timezone = $6, platform = $7, notes = $8
          where id = $1 returning id`,
        [id, v.valor.clienteId, v.valor.nome, v.valor.domain, v.valor.url, v.valor.fuso, v.valor.plataforma, notas],
      );
      if (!r.length) return 0;
      if (monitorar) {
        await db.query(
          `insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, now())
           on conflict (site_id) do update set url = excluded.url, enabled = true`,
          [u.accountId, id, v.valor.url],
        );
      } else {
        await db.query('update monitors set enabled = false where site_id = $1', [id]);
      }
      await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'site.editar', alvoTipo: 'site', alvoId: id, detalhes: { monitorar } });
      return 1;
    });
    if (!n) return { erro: 'Site não encontrado.' };
  } catch (e) {
    if (e instanceof Error && e.message === 'cliente_invalido') return { erro: 'Escolha um cliente ativo.', campos: { cliente: 'Cliente não encontrado.' } };
    const msg = erroDeUnicidade(e);
    if (msg) return { erro: msg, campos: { url: msg } };
    throw e;
  }
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
  return { ok: true, mensagem: 'Site atualizado.' };
}

export async function arquivarSite(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  const desarquivar = texto(fd, 'desarquivar') === '1';
  if (!UUID.test(id)) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query('update sites set archived_at = $2 where id = $1 returning id', [id, desarquivar ? null : new Date()]);
    if (!r.length) return;
    // Arquivar pausa o monitor; desarquivar NÃO religa sozinho — a decisão é de quem opera.
    if (!desarquivar) await db.query('update monitors set enabled = false where site_id = $1', [id]);
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: desarquivar ? 'site.desarquivar' : 'site.arquivar', alvoTipo: 'site', alvoId: id });
  });
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
  if (!desarquivar) redirect('/sites');
}

export async function alternarFavorito(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return;
  await comConta(u.accountId, async (db) => {
    const existe = await db.one('select 1 from site_favorites where user_id = $1 and site_id = $2', [u.userId, id]);
    if (existe) await db.query('delete from site_favorites where user_id = $1 and site_id = $2', [u.userId, id]);
    else {
      // A RLS garante que o site é desta conta; o insert falha em silêncio se não for.
      await db.query(
        `insert into site_favorites (account_id, user_id, site_id)
         select $1, $2, s.id from sites s where s.id = $3 on conflict do nothing`,
        [u.accountId, u.userId, id],
      );
    }
  });
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
}
