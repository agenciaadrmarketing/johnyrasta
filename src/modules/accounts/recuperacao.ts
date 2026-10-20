import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { semConta } from '@/shared/db';
import { lerConfigDeEmail } from '@/modules/notifications/provedor';
import { hashPassword } from '@/modules/accounts/password';
import type { Enviador } from '../../../worker/email';

/** Só há recuperação por e-mail com provedor de verdade E APP_URL para montar o link. */
export function recuperacaoDisponivel(): { disponivel: true } | { disponivel: false; motivo: string } {
  const cfg = lerConfigDeEmail(process.env);
  if (!cfg.ativo) return { disponivel: false, motivo: 'O envio de e-mail não está configurado nesta instalação.' };
  if (cfg.provedor === 'log') return { disponivel: false, motivo: 'O provedor de e-mail está em modo de log (nada é entregue).' };
  if (!(process.env.APP_URL ?? '').trim()) return { disponivel: false, motivo: 'APP_URL não está definido, então não há como montar o link.' };
  return { disponivel: true };
}
export const VALIDADE_DO_LINK_MINUTOS = 60;

export function hashDoLink(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function mensagemDeRecuperacao(nome: string, link: string): { subject: string; text: string } {
  return {
    subject: '[JohnyWeb] Redefinir sua senha',
    text: [
      `Olá, ${nome}.`,
      '',
      `Alguém pediu para redefinir a senha da sua conta na central JohnyWeb. O link abaixo vale por ${VALIDADE_DO_LINK_MINUTOS} minutos e só pode ser usado uma vez:`,
      '',
      link,
      '',
      'Ao concluir, todas as sessões abertas serão encerradas e você entra de novo com a senha nova.',
      'Se não foi você, ignore este e-mail: a senha atual continua valendo.',
    ].join('\n'),
  };
}

/**
 * Pede a redefinição. A resposta da tela é a MESMA exista ou não a conta, e o
 * envio acontece fora do caminho da resposta (o tempo não revela nada).
 * Devolve `true` só quando um e-mail foi entregue ao adaptador (para teste).
 */
export async function iniciarRecuperacao(email: string, o: { enviar: Enviador; urlBase: string; agora?: Date }): Promise<boolean> {
  const token = randomBytes(32).toString('base64url');
  const expira = new Date((o.agora ?? new Date()).getTime() + VALIDADE_DO_LINK_MINUTOS * 60_000);
  const u = await semConta((db) =>
    db.one<{ user_id: string; email: string; name: string }>('select user_id, email, name from app.request_password_reset($1, $2, $3)', [email, hashDoLink(token), expira]),
  );
  if (!u) return false;
  const link = `${o.urlBase.replace(/\/+$/, '')}/redefinir-senha?token=${token}`;
  const m = mensagemDeRecuperacao(u.name, link);
  const r = await o.enviar({ to: u.email, subject: m.subject, text: m.text, alertId: 'recuperacao' });
  if (!r.ok) console.error(`[recuperação] envio falhou: ${r.erro}`);
  return r.ok;
}

export async function linkValido(token: string): Promise<boolean> {
  if (!token) return false;
  const r = await semConta((db) => db.one<{ v: boolean }>('select app.password_reset_valid($1) as v', [hashDoLink(token)]));
  return r?.v === true;
}

/** Consome o link e troca a senha. `null` = link inválido, vencido ou já usado. */
export async function concluirRecuperacao(token: string, novaSenha: string): Promise<{ userId: string; accountId: string } | null> {
  const novoHash = await hashPassword(novaSenha);
  const r = await semConta((db) => db.one<{ user_id: string; account_id: string }>('select user_id, account_id from app.consume_password_reset($1, $2)', [hashDoLink(token), novoHash]));
  return r ? { userId: r.user_id, accountId: r.account_id } : null;
}
