'use server';

import { revalidatePath } from 'next/cache';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';
import { normalizarUrlDoSite } from '@/shared/validation/site';
import { LIMITE_DE_URLS_POR_SITE, chaveDoTrabalho, type Dispositivo } from '@/modules/performance/pagespeed';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

const UUID = /^[0-9a-f-]{36}$/i;
const COOLDOWN_MANUAL_MS = 30 * 60 * 1000;
const texto = (fd: FormData, n: string) => { const v = fd.get(n); return typeof v === 'string' ? v : ''; };

/** Adiciona uma URL prioritária. Precisa ser do MESMO domínio do site (ou www). */
export async function adicionarUrl(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  if (!UUID.test(siteId)) return { erro: 'Site inválido.' };
  const n = normalizarUrlDoSite(texto(fd, 'url'));
  if (!n.ok) return { erro: n.erro, campos: { url: n.erro } };
  const devices = (['mobile', 'desktop'] as Dispositivo[]).filter((d) => fd.get(`dev_${d}`) === '1');
  if (devices.length === 0) return { erro: 'Escolha ao menos um dispositivo.', campos: { devices: 'Escolha mobile, desktop ou os dois.' } };
  try {
    const r = await comConta(u.accountId, async (db) => {
      const site = await db.one<{ domain: string }>('select domain from sites where id = $1 and archived_at is null', [siteId]);
      if (!site) return 'site';
      if (n.domain !== site.domain) return 'dominio';
      const total = await db.one<{ n: number }>('select count(*)::int as n from monitored_urls where site_id = $1 and archived_at is null', [siteId]);
      if ((total?.n ?? 0) >= LIMITE_DE_URLS_POR_SITE) return 'limite';
      await db.query(`insert into monitored_urls (account_id, site_id, url, priority, devices) values ($1, $2, $3, $4, $5)`, [u.accountId, siteId, n.url, Math.min(3, (total?.n ?? 0) + 1), devices]);
      await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'url.adicionar', alvoTipo: 'site', alvoId: siteId, detalhes: { url: n.url, devices } });
      return 'ok';
    });
    if (r === 'site') return { erro: 'Site não encontrado.' };
    if (r === 'dominio') return { erro: 'A URL precisa ser do domínio deste site.', campos: { url: 'A URL precisa ser do domínio deste site.' } };
    if (r === 'limite') return { erro: `Limite de ${LIMITE_DE_URLS_POR_SITE} URLs por site. Remova uma para adicionar outra.` };
  } catch (e) {
    if (e instanceof Error && e.message.includes('monitored_urls_site_url_key')) return { erro: 'Esta URL já está na lista.', campos: { url: 'Esta URL já está na lista.' } };
    throw e;
  }
  revalidatePath(`/sites/${siteId}/velocidade`);
  return { ok: true, mensagem: 'URL adicionada. A primeira medição entra na próxima agenda do worker.' };
}

export async function removerUrl(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  const siteId = texto(fd, 'site');
  if (!UUID.test(id) || !UUID.test(siteId)) return;
  await comConta(u.accountId, async (db) => {
    const r = await db.query('update monitored_urls set archived_at = now(), enabled = false where id = $1 and site_id = $2 returning id', [id, siteId]);
    if (r.length) {
      await db.query(`update audit_jobs set state = 'cancelado', finished_at = now() where kind = 'pagespeed' and state = 'pendente' and payload->>'monitoredUrlId' = $1`, [id]);
      await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'url.remover', alvoTipo: 'site', alvoId: siteId, detalhes: { monitoredUrlId: id } });
    }
  });
  revalidatePath(`/sites/${siteId}/velocidade`);
}

/** Medição manual: enfileira um trabalho por dispositivo (chave manual), com cooldown de 30 min por URL. Não bloqueia a tela. */
export async function medirAgora(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const id = texto(fd, 'id');
  const siteId = texto(fd, 'site');
  if (!UUID.test(id) || !UUID.test(siteId)) return;
  if (!process.env.PAGESPEED_API_KEY) return;
  await comConta(u.accountId, async (db) => {
    const url = await db.one<{ url: string; devices: Dispositivo[] }>('select url, devices from monitored_urls where id = $1 and site_id = $2 and archived_at is null', [id, siteId]);
    if (!url) return;
    const recente = await db.one('select 1 from audit_jobs where payload->>\'monitoredUrlId\' = $1 and dedupe_key like $2 and created_at > now() - make_interval(secs => $3)', [id, `pagespeed:${id}:%:manual-%`, COOLDOWN_MANUAL_MS / 1000]);
    if (recente) return;
    const carimbo = `manual-${Date.now()}`;
    for (const d of url.devices) {
      await db.query(
        `insert into audit_jobs (account_id, site_id, kind, dedupe_key, payload) values ($1, $2, 'pagespeed', $3, $4) on conflict do nothing`,
        [u.accountId, siteId, chaveDoTrabalho(id, d, carimbo), JSON.stringify({ monitoredUrlId: id, url: url.url, device: d, manual: true })],
      );
    }
    await auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'pagespeed.medir_agora', alvoTipo: 'site', alvoId: siteId, detalhes: { monitoredUrlId: id } });
  });
  revalidatePath(`/sites/${siteId}/velocidade`);
}
