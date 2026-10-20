/**
 * Importação do cadastro da V1: clientes, sites e URLs prioritárias.
 *
 * NÃO importa eventos, leads nem medições: a V1 mede de outro jeito (outro
 * modelo de sessão, outra janela, outro Lighthouse) e misturar séries
 * inventaria continuidade. Os números da V2 começam quando o coletor da V2
 * for instalado.
 *
 * Sem `server-only`: o script de linha de comando e os testes importam daqui.
 * O formato de entrada é o JSON gerado pela consulta de `docs/IMPORTAR-V1.md`.
 */
import type { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { fusoValido, normalizarUrlDoSite, plataformaValida, type Plataforma } from '@/shared/validation/site';

export type DadosV1 = {
  clients: { id: string; name: string; notes?: string | null; archived_at?: string | null }[];
  sites: { id: string; client_id: string; name: string; domain: string; timezone?: string | null; platform?: string | null; archived_at?: string | null }[];
  monitored_urls?: { site_id: string; url: string; prioritaria?: boolean | null }[];
};

export type ItemDoPlano =
  | { tipo: 'cliente'; v1Id: string; nome: string; acao: 'criar' | 'reaproveitar' }
  | { tipo: 'site'; v1Id: string; nome: string; domain: string; url: string; acao: 'criar'; clienteV1Id: string; fuso: string; plataforma: Plataforma; urlsPrioritarias: string[] }
  | { tipo: 'site'; v1Id: string; nome: string; acao: 'ignorar'; motivo: string };

export type Existentes = { clientes: Set<string>; dominios: Set<string> };

const chave = (nome: string) => nome.trim().toLowerCase();

/** Plano puro: o que seria criado, reaproveitado ou ignorado (e por quê). Não toca no banco. */
export function planejarImportacao(dados: DadosV1, existentes: Existentes): ItemDoPlano[] {
  const plano: ItemDoPlano[] = [];
  const clientesUsados = new Set<string>();
  const dominiosVistos = new Set(existentes.dominios);
  const urlsPorSite = new Map<string, string[]>();
  for (const u of dados.monitored_urls ?? []) {
    if (!u.prioritaria) continue;
    urlsPorSite.set(u.site_id, [...(urlsPorSite.get(u.site_id) ?? []), u.url]);
  }
  const clientePorId = new Map(dados.clients.map((c) => [c.id, c]));

  const sitesPlano: ItemDoPlano[] = [];
  for (const s of dados.sites) {
    const nome = (s.name ?? '').trim();
    const ignorar = (motivo: string) => sitesPlano.push({ tipo: 'site', v1Id: s.id, nome: nome || s.domain || s.id, acao: 'ignorar', motivo });
    if (s.archived_at) { ignorar('arquivado na V1'); continue; }
    const cliente = clientePorId.get(s.client_id);
    if (!cliente) { ignorar('cliente não encontrado no arquivo'); continue; }
    if (cliente.archived_at) { ignorar('cliente arquivado na V1'); continue; }
    if (nome.length < 2 || nome.length > 80) { ignorar('nome fora de 2 a 80 caracteres'); continue; }
    // A V1 guardava só o domínio; sem a URL completa, a principal é https://<domínio>.
    const url = normalizarUrlDoSite(s.domain ?? '');
    if (!url.ok) { ignorar(`domínio inválido (${url.erro})`); continue; }
    if (dominiosVistos.has(url.domain)) { ignorar('domínio já cadastrado na V2'); continue; }
    dominiosVistos.add(url.domain);
    const fuso = s.timezone && fusoValido(s.timezone) ? s.timezone : 'America/Sao_Paulo';
    const plataforma: Plataforma = s.platform && plataformaValida(s.platform) ? s.platform : 'outro';
    const prioritarias: string[] = [];
    for (const bruta of urlsPorSite.get(s.id) ?? []) {
      const n = normalizarUrlDoSite(bruta);
      if (n.ok && n.domain === url.domain && !prioritarias.includes(n.url) && prioritarias.length < 3) prioritarias.push(n.url);
    }
    clientesUsados.add(cliente.id);
    sitesPlano.push({ tipo: 'site', v1Id: s.id, nome, domain: url.domain, url: url.url, acao: 'criar', clienteV1Id: cliente.id, fuso, plataforma, urlsPrioritarias: prioritarias });
  }
  for (const c of dados.clients) {
    if (!clientesUsados.has(c.id)) continue;
    plano.push({ tipo: 'cliente', v1Id: c.id, nome: c.name.trim(), acao: existentes.clientes.has(chave(c.name)) ? 'reaproveitar' : 'criar' });
  }
  return [...plano, ...sitesPlano];
}

export type ResultadoDaImportacao = { clientesCriados: number; clientesReaproveitados: number; sitesCriados: number; sitesIgnorados: number; urlsPrioritarias: number };

export async function lerExistentes(db: Client, accountId: string): Promise<Existentes> {
  const c = await db.query<{ n: string }>('select lower(name) as n from clients where account_id = $1 and archived_at is null', [accountId]);
  const s = await db.query<{ d: string }>('select domain as d from sites where account_id = $1 and archived_at is null', [accountId]);
  return { clientes: new Set(c.rows.map((r) => r.n)), dominios: new Set(s.rows.map((r) => r.d)) };
}

/** Aplica o plano numa transação. `db` é o administrador (a RLS não se aplica): o `accountId` vem do operador. */
export async function aplicarImportacao(db: Client, accountId: string, dados: DadosV1, o: { monitorar: boolean; agora?: Date }): Promise<{ plano: ItemDoPlano[]; resultado: ResultadoDaImportacao }> {
  await db.query('begin');
  try {
    const plano = planejarImportacao(dados, await lerExistentes(db, accountId));
    const r: ResultadoDaImportacao = { clientesCriados: 0, clientesReaproveitados: 0, sitesCriados: 0, sitesIgnorados: 0, urlsPrioritarias: 0 };
    const clienteV2 = new Map<string, string>();
    const v1Clientes = new Map(dados.clients.map((c) => [c.id, c]));
    for (const it of plano) {
      if (it.tipo !== 'cliente') continue;
      const existente = await db.query<{ id: string }>('select id from clients where account_id = $1 and archived_at is null and lower(name) = lower($2)', [accountId, it.nome]);
      if (existente.rows[0]) { clienteV2.set(it.v1Id, existente.rows[0].id); r.clientesReaproveitados += 1; continue; }
      const nota = v1Clientes.get(it.v1Id)?.notes?.trim().slice(0, 2000) || null;
      const novo = await db.query<{ id: string }>('insert into clients (account_id, name, notes) values ($1, $2, $3) returning id', [accountId, it.nome, nota]);
      clienteV2.set(it.v1Id, novo.rows[0]!.id);
      r.clientesCriados += 1;
    }
    for (const it of plano) {
      if (it.tipo !== 'site') continue;
      if (it.acao === 'ignorar') { r.sitesIgnorados += 1; continue; }
      const s = await db.query<{ id: string }>(
        `insert into sites (account_id, client_id, name, domain, primary_url, timezone, platform, public_id, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [accountId, clienteV2.get(it.clienteV1Id), it.nome, it.domain, it.url, it.fuso, it.plataforma, randomBytes(9).toString('base64url'), 'Importado da V1.'],
      );
      r.sitesCriados += 1;
      if (o.monitorar) await db.query('insert into monitors (account_id, site_id, url, next_check_at) values ($1, $2, $3, $4)', [accountId, s.rows[0]!.id, it.url, o.agora ?? new Date()]);
      for (const [i, url] of it.urlsPrioritarias.entries()) {
        await db.query('insert into monitored_urls (account_id, site_id, url, priority) values ($1, $2, $3, $4)', [accountId, s.rows[0]!.id, url, i + 1]);
        r.urlsPrioritarias += 1;
      }
    }
    await db.query(`insert into audit_log (account_id, action, target_type, details) values ($1, 'importacao.v1', 'account', $2)`, [accountId, JSON.stringify({ ...r, monitorar: o.monitorar })]);
    await db.query('commit');
    return { plano, resultado: r };
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  }
}
