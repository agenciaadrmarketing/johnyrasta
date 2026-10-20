import 'server-only';
import { comConta } from '@/shared/db';
import { TIPOS_DE_ALERTA } from '@/modules/notifications/regras';
import { lerConfigDeEmail, type ConfigDeEmail } from '@/modules/notifications/provedor';

export type PreferenciasDeNotificacao = {
  emailEnabled: boolean;
  recipients: string[];
  kinds: string[];
  /** `null` quando a conta nunca salvou: tudo é padrão (e-mail desligado). */
  updatedAt: Date | null;
};

export type Entrega = {
  id: string;
  recipient: string;
  alertKind: string;
  alertTitle: string;
  siteNome: string | null;
  state: 'pendente' | 'enviado' | 'falhou' | 'descartado';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  provider: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date;
};

export const ROTULO_ENTREGA: Record<Entrega['state'], string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  falhou: 'Falhou',
  descartado: 'Descartado',
};

export async function preferenciasDeNotificacao(accountId: string): Promise<PreferenciasDeNotificacao> {
  const r = await comConta(accountId, (db) =>
    db.one<{ email_enabled: boolean; email_recipients: string[]; kinds: string[]; updated_at: Date }>(
      'select email_enabled, email_recipients, kinds, updated_at from notification_settings where account_id = $1',
      [accountId],
    ),
  );
  if (!r) return { emailEnabled: false, recipients: [], kinds: [...TIPOS_DE_ALERTA], updatedAt: null };
  return { emailEnabled: r.email_enabled, recipients: r.email_recipients, kinds: r.kinds, updatedAt: r.updated_at };
}

/** Preferência do site: sem linha = ligado. */
export async function emailLigadoParaOSite(accountId: string, siteId: string): Promise<boolean> {
  const r = await comConta(accountId, (db) => db.one<{ email_enabled: boolean }>('select email_enabled from site_notification_prefs where site_id = $1', [siteId]));
  return r ? r.email_enabled : true;
}

export async function ultimasEntregas(accountId: string, limite = 10): Promise<Entrega[]> {
  return comConta(accountId, (db) =>
    db.query<Entrega>(
      `select d.id, d.recipient, a.kind as "alertKind", a.title as "alertTitle", s.name as "siteNome", d.state, d.attempts,
              d.max_attempts as "maxAttempts", d.last_error as "lastError", d.provider, d.created_at as "createdAt",
              d.updated_at as "updatedAt", d.sent_at as "sentAt", d.next_attempt_at as "nextAttemptAt"
         from alert_deliveries d
         join alerts a on a.id = d.alert_id
         left join sites s on s.id = a.site_id
        order by d.created_at desc, d.recipient
        limit $1`,
      [limite],
    ),
  );
}

export type EstadoDoProvedor = {
  /** O que a APLICAÇÃO lê do seu ambiente. */
  aplicacao: ConfigDeEmail;
  /** O que o WORKER informou no último heartbeat, quando informou. */
  worker: { provedor: string | null; pendentes: number; falhas24h: number } | null;
};

/**
 * Estado do provedor. A aplicação e o worker são processos separados e podem
 * ter ambientes diferentes; a tela mostra os dois para ninguém acreditar que
 * "configurei aqui" significa "o worker envia".
 */
export async function estadoDoProvedorDeEmail(accountId: string): Promise<EstadoDoProvedor> {
  const aplicacao = lerConfigDeEmail(process.env);
  const hb = await comConta(accountId, (db) =>
    db.one<{ email: { provedor?: unknown; pendentes?: unknown; falhas24h?: unknown } | null }>(
      `select details->'email' as email from worker_heartbeats order by seen_at desc limit 1`,
    ),
  );
  const e = hb?.email;
  // Pendentes e falhas são DESTA conta (RLS), não o total global que o heartbeat carrega:
  // o heartbeat é do processo, que atende todas as contas.
  const c = await comConta(accountId, (db) =>
    db.one<{ pendentes: number; falhas24h: number }>(
      `select count(*) filter (where state = 'pendente')::int as pendentes,
              count(*) filter (where state = 'falhou' and updated_at > now() - interval '24 hours')::int as "falhas24h"
         from alert_deliveries`,
    ),
  );
  const worker =
    e && typeof e === 'object'
      ? { provedor: typeof e.provedor === 'string' ? e.provedor : null, pendentes: c?.pendentes ?? 0, falhas24h: c?.falhas24h ?? 0 }
      : null;
  return { aplicacao, worker };
}
