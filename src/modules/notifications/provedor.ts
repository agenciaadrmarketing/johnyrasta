/**
 * Leitura da configuração do provedor de e-mail a partir do ambiente. Puro:
 * recebe o ambiente, devolve um objeto; nenhum segredo sai daqui para a tela.
 *
 * Usado pelo worker (para criar o adaptador) e pela central (para mostrar o
 * estado real: "nenhum provedor configurado" nunca vira "funcionando").
 */

export const PROVEDORES = ['resend', 'postmark', 'webhook', 'log'] as const;
export type ProvedorDeEmail = (typeof PROVEDORES)[number];

export type ConfigDeEmail =
  | {
      ativo: true;
      provedor: ProvedorDeEmail;
      from: string | null;
      apiKey: string | null;
      webhookUrl: string | null;
      /** Texto curto e SEM segredo, para log e tela. */
      descricao: string;
    }
  | { ativo: false; provedor: null; motivo: string };

export const ROTULO_PROVEDOR: Record<ProvedorDeEmail, string> = {
  resend: 'Resend',
  postmark: 'Postmark',
  webhook: 'Webhook',
  log: 'Log (só console)',
};

export function lerConfigDeEmail(env: Record<string, string | undefined>): ConfigDeEmail {
  const nome = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (!nome) return { ativo: false, provedor: null, motivo: 'EMAIL_PROVIDER ausente' };
  if (!(PROVEDORES as readonly string[]).includes(nome)) {
    return { ativo: false, provedor: null, motivo: `EMAIL_PROVIDER "${nome}" não é reconhecido (use resend, postmark, webhook ou log)` };
  }
  const provedor = nome as ProvedorDeEmail;
  const from = (env.EMAIL_FROM ?? '').trim() || null;
  const apiKey = (env.EMAIL_API_KEY ?? '').trim() || null;
  const webhookUrl = (env.EMAIL_WEBHOOK_URL ?? '').trim() || null;

  if (provedor === 'resend' || provedor === 'postmark') {
    if (!apiKey) return { ativo: false, provedor: null, motivo: `EMAIL_PROVIDER=${provedor} exige EMAIL_API_KEY` };
    if (!from) return { ativo: false, provedor: null, motivo: `EMAIL_PROVIDER=${provedor} exige EMAIL_FROM` };
    return { ativo: true, provedor, from, apiKey, webhookUrl: null, descricao: `${ROTULO_PROVEDOR[provedor]} · remetente ${from}` };
  }
  if (provedor === 'webhook') {
    let host: string | null = null;
    try {
      const u = new URL(webhookUrl ?? '');
      if (u.protocol === 'http:' || u.protocol === 'https:') host = u.host;
    } catch {
      host = null;
    }
    if (!host) return { ativo: false, provedor: null, motivo: 'EMAIL_PROVIDER=webhook exige EMAIL_WEBHOOK_URL (http ou https)' };
    return { ativo: true, provedor, from, apiKey, webhookUrl, descricao: `Webhook · ${host}` };
  }
  return { ativo: true, provedor: 'log', from, apiKey: null, webhookUrl: null, descricao: 'Log · só registra no console do worker; nada é entregue' };
}
