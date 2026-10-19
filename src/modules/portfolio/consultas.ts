import 'server-only';
import { comConta, type Queryable } from '@/shared/db';
import { situacaoDoSite, type Situacao } from '@/modules/portfolio/situacao';

export type Cliente = {
  id: string;
  name: string;
  notes: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  totalSites: number;
};

export type Site = {
  id: string;
  clientId: string;
  clienteNome: string;
  name: string;
  domain: string;
  primaryUrl: string;
  timezone: string;
  platform: string;
  publicId: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  favorito: boolean;
  monitor: null | MonitorDoSite;
};

export type MonitorDoSite = {
  id: string;
  enabled: boolean;
  intervalSeconds: number;
  maintenanceUntil: Date | null;
  lastCheckAt: Date | null;
  lastOk: boolean | null;
  consecutiveFailures: number;
  tlsState: 'desconhecido' | 'valido' | 'sem_tls' | 'falha';
  tlsExpiresAt: Date | null;
  manualRequestedAt: Date | null;
  nextCheckAt: Date | null;
  incidenteAberto: null | { id: string; firstFailureAt: Date; confirmedAt: Date | null; failedChecks: number };
  ultimaRecuperacao: Date | null;
};

export type SiteComSituacao = Site & { situacao: Situacao };

function comSituacao(s: Site): SiteComSituacao {
  return {
    ...s,
    situacao: situacaoDoSite(s.id, {
      arquivado: s.archivedAt !== null,
      monitor: s.monitor
        ? {
            habilitado: s.monitor.enabled,
            intervaloSegundos: s.monitor.intervalSeconds,
            manutencaoAte: s.monitor.maintenanceUntil,
            ultimaChecagem: s.monitor.lastCheckAt ? { em: s.monitor.lastCheckAt, ok: s.monitor.lastOk ?? false } : null,
            incidenteAberto: s.monitor.incidenteAberto
              ? { desde: s.monitor.incidenteAberto.firstFailureAt, confirmado: s.monitor.incidenteAberto.confirmedAt !== null }
              : null,
            recuperadoEm: s.monitor.ultimaRecuperacao,
          }
        : null,
    }),
  };
}

const SELECT_SITE = `
  select s.id, s.client_id as "clientId", c.name as "clienteNome", s.name, s.domain,
         s.primary_url as "primaryUrl", s.timezone, s.platform, s.public_id as "publicId", s.notes,
         s.created_at as "createdAt", s.updated_at as "updatedAt", s.archived_at as "archivedAt",
         (f.site_id is not null) as favorito,
         case when m.id is null then null else json_build_object(
           'id', m.id, 'enabled', m.enabled, 'intervalSeconds', m.interval_seconds, 'maintenanceUntil', m.maintenance_until,
           'lastCheckAt', m.last_check_at, 'lastOk', m.last_ok, 'consecutiveFailures', m.consecutive_failures,
           'tlsState', m.tls_state, 'tlsExpiresAt', m.tls_expires_at, 'manualRequestedAt', m.manual_requested_at,
           'nextCheckAt', m.next_check_at,
           'incidenteAberto', (select json_build_object('id', i.id, 'firstFailureAt', i.first_failure_at, 'confirmedAt', i.confirmed_at, 'failedChecks', i.failed_checks)
                                 from incidents i where i.monitor_id = m.id and i.recovered_at is null limit 1),
           'ultimaRecuperacao', (select max(i.recovered_at) from incidents i where i.monitor_id = m.id and i.outcome = 'confirmado')
         ) end as monitor
    from sites s
    join clients c on c.id = s.client_id
    left join monitors m on m.site_id = s.id
    left join site_favorites f on f.site_id = s.id and f.user_id = $1
`;

type MonitorBruto = {
  id: string; enabled: boolean; intervalSeconds: number; maintenanceUntil: string | null; lastCheckAt: string | null; lastOk: boolean | null;
  consecutiveFailures: number; tlsState: MonitorDoSite['tlsState']; tlsExpiresAt: string | null; manualRequestedAt: string | null; nextCheckAt: string | null;
  incidenteAberto: null | { id: string; firstFailureAt: string; confirmedAt: string | null; failedChecks: number };
  ultimaRecuperacao: string | null;
};
const dataOuNull = (v: string | null) => (v ? new Date(v) : null);

function hidratar(linha: Site): Site {
  const m = linha.monitor as unknown as MonitorBruto | null;
  return {
    ...linha,
    monitor: m
      ? {
          ...m,
          maintenanceUntil: dataOuNull(m.maintenanceUntil),
          lastCheckAt: dataOuNull(m.lastCheckAt),
          tlsExpiresAt: dataOuNull(m.tlsExpiresAt),
          manualRequestedAt: dataOuNull(m.manualRequestedAt),
          nextCheckAt: dataOuNull(m.nextCheckAt),
          incidenteAberto: m.incidenteAberto
            ? { ...m.incidenteAberto, firstFailureAt: new Date(m.incidenteAberto.firstFailureAt), confirmedAt: dataOuNull(m.incidenteAberto.confirmedAt) }
            : null,
          ultimaRecuperacao: dataOuNull(m.ultimaRecuperacao),
        }
      : null,
  };
}

export type FiltroDeSites = 'todos' | 'atencao' | 'favoritos' | 'arquivados';

export function filtroValido(v: string | null | undefined): FiltroDeSites {
  return v === 'atencao' || v === 'favoritos' || v === 'arquivados' ? v : 'todos';
}

export async function listarSites(
  accountId: string,
  userId: string,
  opcoes: { busca?: string; filtro?: FiltroDeSites; clienteId?: string } = {},
): Promise<SiteComSituacao[]> {
  const sites = await comConta(accountId, async (db) => {
    const linhas = await db.query<Site>(
      `${SELECT_SITE}
       where ($2::text is null or s.name ilike '%' || $2 || '%' or s.domain ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%')
         and ($3::uuid is null or s.client_id = $3)
       order by s.archived_at nulls first, lower(s.name)`,
      [userId, opcoes.busca?.trim() || null, opcoes.clienteId ?? null],
    );
    return linhas.map(hidratar).map(comSituacao);
  });
  const filtro = opcoes.filtro ?? 'todos';
  const filtrados = sites.filter((s) => {
    if (filtro === 'arquivados') return s.archivedAt !== null;
    if (s.archivedAt !== null) return false;
    if (filtro === 'favoritos') return s.favorito;
    if (filtro === 'atencao') return s.situacao.proximaAcao !== null;
    return true;
  });
  // Incidentes e atrasos primeiro; depois quem precisa de decisão; depois o resto.
  return filtrados.sort((a, b) => a.situacao.prioridade - b.situacao.prioridade || a.name.localeCompare(b.name, 'pt-BR'));
}

export async function contagensDeFiltros(accountId: string, userId: string): Promise<Record<FiltroDeSites, number>> {
  const todos = await listarSites(accountId, userId);
  return {
    todos: todos.filter((s) => s.archivedAt === null).length,
    atencao: todos.filter((s) => s.archivedAt === null && s.situacao.proximaAcao !== null).length,
    favoritos: todos.filter((s) => s.archivedAt === null && s.favorito).length,
    arquivados: todos.filter((s) => s.archivedAt !== null).length,
  };
}

export async function buscarSite(accountId: string, userId: string, siteId: string): Promise<SiteComSituacao | null> {
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) return null;
  return comConta(accountId, async (db) => {
    const linha = await db.one<Site>(`${SELECT_SITE} where s.id = $2`, [userId, siteId]);
    return linha ? comSituacao(hidratar(linha)) : null;
  });
}

export async function listarClientes(accountId: string, incluirArquivados = false): Promise<Cliente[]> {
  return comConta(accountId, (db) =>
    db.query<Cliente>(
      `select c.id, c.name, c.notes, c.created_at as "createdAt", c.archived_at as "archivedAt",
              (select count(*)::int from sites s where s.client_id = c.id and s.archived_at is null) as "totalSites"
         from clients c
        where ($1::boolean or c.archived_at is null)
        order by c.archived_at nulls first, lower(c.name)`,
      [incluirArquivados],
    ),
  );
}

export async function buscarCliente(accountId: string, clienteId: string): Promise<Cliente | null> {
  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) return null;
  return comConta(accountId, (db) =>
    db.one<Cliente>(
      `select c.id, c.name, c.notes, c.created_at as "createdAt", c.archived_at as "archivedAt",
              (select count(*)::int from sites s where s.client_id = c.id and s.archived_at is null) as "totalSites"
         from clients c where c.id = $1`,
      [clienteId],
    ),
  );
}

export async function contagensDoMenu(accountId: string): Promise<{ sites: number; clientes: number; atencao: number }> {
  return comConta(accountId, async (db) => {
    const r = await db.one<{ sites: number; clientes: number }>(
      `select (select count(*)::int from sites where archived_at is null) as sites,
              (select count(*)::int from clients where archived_at is null) as clientes`,
    );
    return { sites: r?.sites ?? 0, clientes: r?.clientes ?? 0, atencao: 0 };
  });
}

/** Heartbeat do worker, para a tela de Configurações. `null` = nunca visto. */
export async function estadoDoWorker(accountId: string): Promise<null | { workerId: string; seenAt: Date; version: string | null }> {
  return comConta(accountId, (db) =>
    db.one<{ workerId: string; seenAt: Date; version: string | null }>(
      `select worker_id as "workerId", seen_at as "seenAt", version from worker_heartbeats order by seen_at desc limit 1`,
    ),
  );
}

/** O worker se apresenta a cada 30 s; cinco minutos sem sinal é ausência, não atraso de rede. */
export function workerSemSinal(seenAt: Date, agora: Date = new Date()): boolean {
  return agora.getTime() - seenAt.getTime() > 5 * 60 * 1000;
}

export type { Queryable };
