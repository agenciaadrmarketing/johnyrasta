'use server';

import { revalidatePath } from 'next/cache';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { comConta } from '@/shared/db';
import { analisarDestinatarios, MAXIMO_DESTINATARIOS, TIPOS_DE_ALERTA } from '@/modules/notifications/regras';
import { lerConfigDeEmail } from '@/modules/notifications/provedor';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

const UUID = /^[0-9a-f-]{36}$/i;
const texto = (fd: FormData, n: string) => {
  const v = fd.get(n);
  return typeof v === 'string' ? v : '';
};

/**
 * Preferências de e-mail da conta. Salvar move `updated_at`: só alertas
 * criados depois disso são enfileirados (ligar não despeja histórico).
 */
export async function salvarNotificacoes(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const ligar = fd.get('email_enabled') === '1';
  const { validos, invalidos } = analisarDestinatarios(texto(fd, 'destinatarios'));
  if (invalidos.length) {
    const msg = `Endereço inválido: ${invalidos.slice(0, 3).join(', ')}${invalidos.length > 3 ? '…' : ''}`;
    return { erro: msg, campos: { destinatarios: msg } };
  }
  if (validos.length > MAXIMO_DESTINATARIOS) {
    const msg = `No máximo ${MAXIMO_DESTINATARIOS} destinatários.`;
    return { erro: msg, campos: { destinatarios: msg } };
  }
  if (ligar && validos.length === 0) {
    const msg = 'Informe ao menos um destinatário para ligar o e-mail.';
    return { erro: msg, campos: { destinatarios: msg } };
  }
  const kinds = TIPOS_DE_ALERTA.filter((k) => fd.get(`tipo_${k}`) === '1');
  if (ligar && kinds.length === 0) return { erro: 'Escolha ao menos um tipo de alerta para receber.' };

  await comConta(u.accountId, async (db) => {
    await db.query(
      `insert into notification_settings (account_id, email_enabled, email_recipients, kinds, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (account_id) do update set email_enabled = $2, email_recipients = $3, kinds = $4, updated_at = now()`,
      [u.accountId, ligar, validos, kinds],
    );
    await auditar(db, {
      accountId: u.accountId,
      userId: u.userId,
      acao: 'notificacoes.salvar',
      alvoTipo: 'account',
      alvoId: u.accountId,
      detalhes: { emailEnabled: ligar, destinatarios: validos.length, kinds },
    });
  });
  revalidatePath('/configuracoes');

  const provedor = lerConfigDeEmail(process.env);
  if (ligar && !provedor.ativo) {
    return { ok: true, mensagem: 'Preferência salva; nada será enviado até configurar EMAIL_PROVIDER no worker. Até lá os alertas ficam só na central.' };
  }
  return {
    ok: true,
    mensagem: ligar
      ? `Preferências salvas. Alertas gerados a partir de agora vão para ${validos.length} ${validos.length === 1 ? 'destinatário' : 'destinatários'}.`
      : 'Preferências salvas. E-mail desligado: alertas ficam só na central.',
  };
}

/** Liga ou desliga o e-mail para UM site. Sem linha = ligado; a linha existe para registrar a decisão. */
export async function alternarEmailDoSite(fd: FormData): Promise<void> {
  const u = await exigirSessao();
  const siteId = texto(fd, 'site');
  const ligar = texto(fd, 'ligar') === '1';
  if (!UUID.test(siteId)) return;
  await comConta(u.accountId, async (db) => {
    // `select ... from sites` passa pela RLS: site de outra conta = nenhuma linha, nada gravado.
    const r = await db.query(
      `insert into site_notification_prefs (site_id, account_id, email_enabled, updated_at)
       select s.id, s.account_id, $2, now() from sites s where s.id = $1
       on conflict (site_id) do update set email_enabled = $2, updated_at = now()
       returning site_id`,
      [siteId, ligar],
    );
    if (r.length) await auditar(db, { accountId: u.accountId, userId: u.userId, acao: ligar ? 'notificacoes.site.ligar' : 'notificacoes.site.desligar', alvoTipo: 'site', alvoId: siteId });
  });
  revalidatePath(`/sites/${siteId}/disponibilidade`);
}
