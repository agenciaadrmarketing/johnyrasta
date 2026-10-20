'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { comConta } from '@/shared/db';
import { emailValido, validarSenha } from '@/shared/validation/conta';
import { lerConfigDeEmail } from '@/modules/notifications/provedor';
import { criarEnviador } from '../../../worker/email';
import { auditar } from '@/modules/accounts/auditoria';
import { concluirRecuperacao, iniciarRecuperacao, recuperacaoDisponivel } from '@/modules/accounts/recuperacao';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

function texto(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
}

const RESPOSTA = 'Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. Ele vale por 60 minutos.';

export async function pedirRecuperacao(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const d = recuperacaoDisponivel();
  if (!d.disponivel) return { erro: `${d.motivo} Peça a quem administra a central para redefinir a senha.` };
  const email = texto(fd, 'email').trim();
  if (!emailValido(email)) return { erro: 'Informe um e-mail válido.', campos: { email: 'Informe um e-mail válido.' } };
  const enviar = criarEnviador(lerConfigDeEmail(process.env));
  const urlBase = (process.env.APP_URL ?? '').trim();
  // Fora do caminho da resposta: com ou sem conta, a tela demora o mesmo.
  if (enviar) after(async () => { await iniciarRecuperacao(email, { enviar, urlBase }).catch((e) => console.error('[recuperação]', e instanceof Error ? e.message : e)); });
  return { ok: true, mensagem: RESPOSTA };
}

export async function redefinirSenha(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const token = texto(fd, 'token');
  const nova = texto(fd, 'nova');
  const problema = validarSenha(nova);
  if (problema) return { erro: problema, campos: { nova: problema } };
  if (nova !== texto(fd, 'confirmacao')) return { erro: 'A confirmação não confere.', campos: { confirmacao: 'A confirmação não confere.' } };
  const r = await concluirRecuperacao(token, nova);
  if (!r) return { erro: 'Este link é inválido, venceu ou já foi usado. Peça um novo.' };
  await comConta(r.accountId, (db) => auditar(db, { accountId: r.accountId, userId: r.userId, acao: 'senha.recuperar', alvoTipo: 'user', alvoId: r.userId }));
  redirect('/entrar?senha=redefinida');
}
