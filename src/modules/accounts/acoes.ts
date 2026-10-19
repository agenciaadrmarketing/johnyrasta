'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { semConta, comConta } from '@/shared/db';
import { hashPassword, verifyPassword } from '@/modules/accounts/password';
import { criarSessao, encerrarSessao, tokenAtualHash, usuarioDaSessao } from '@/modules/accounts/session';
import { exigirSessao } from '@/modules/accounts/contexto';
import { auditar } from '@/modules/accounts/auditoria';
import { emailValido, validarSenha } from '@/shared/validation/conta';
import type { EstadoFormulario } from '@/shared/ui/Formulario';

function texto(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : '';
}

/**
 * Login. A mensagem de erro é UMA só para e-mail inexistente e senha errada:
 * distinguir os dois confirmaria quais e-mails têm conta.
 */
export async function entrar(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const email = texto(fd, 'email').trim();
  const senha = texto(fd, 'senha');
  if (!emailValido(email) || !senha) return { erro: 'E-mail ou senha incorretos.' };

  const u = await semConta((db) =>
    db.one<{ user_id: string; password_hash: string }>('select user_id, password_hash from app.find_user_for_login($1)', [email]),
  );
  // Verifica um hash mesmo sem usuário, para o tempo de resposta não revelar
  // se o e-mail existe.
  const ok = await verifyPassword(senha, u?.password_hash ?? 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!u || !ok) return { erro: 'E-mail ou senha incorretos.' };

  await criarSessao(u.user_id);
  const destino = texto(fd, 'destino');
  redirect(destino.startsWith('/') && !destino.startsWith('//') ? destino : '/sites');
}

export async function sair(): Promise<void> {
  await encerrarSessao();
  redirect('/entrar');
}

export async function atualizarPerfil(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const nome = texto(fd, 'nome').trim();
  if (nome.length < 2 || nome.length > 80) return { erro: 'Nome entre 2 e 80 caracteres.', campos: { nome: 'Nome entre 2 e 80 caracteres.' } };
  await semConta((db) => db.query('select app.update_profile($1, $2)', [u.userId, nome]));
  await comConta(u.accountId, (db) => auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'perfil.editar', alvoTipo: 'user', alvoId: u.userId }));
  revalidatePath('/configuracoes');
  return { ok: true, mensagem: 'Nome atualizado.' };
}

/** Troca de senha exige a senha atual: alteração sensível pede reautenticação. */
export async function trocarSenha(_: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const u = await exigirSessao();
  const atual = texto(fd, 'atual');
  const nova = texto(fd, 'nova');
  const confirmacao = texto(fd, 'confirmacao');
  const problema = validarSenha(nova);
  if (problema) return { erro: problema, campos: { nova: problema } };
  if (nova !== confirmacao) return { erro: 'A confirmação não confere.', campos: { confirmacao: 'A confirmação não confere.' } };
  const hash = await semConta((db) => db.one<{ h: string }>('select app.password_hash_of($1) as h', [u.userId]));
  if (!hash || !(await verifyPassword(atual, hash.h))) return { erro: 'Senha atual incorreta.', campos: { atual: 'Senha atual incorreta.' } };
  const novoHash = await hashPassword(nova);
  const manter = await tokenAtualHash();
  await semConta(async (db) => {
    await db.query('select app.update_password($1, $2)', [u.userId, novoHash]);
    // Trocar a senha encerra as outras sessões: é o que se espera de "troquei
    // a senha porque alguém pode ter a antiga".
    if (manter) await db.query('select app.revoke_other_sessions($1, $2)', [u.userId, manter]);
  });
  await comConta(u.accountId, (db) => auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'senha.trocar', alvoTipo: 'user', alvoId: u.userId }));
  revalidatePath('/configuracoes');
  return { ok: true, mensagem: 'Senha alterada. As outras sessões foram encerradas.' };
}

export async function encerrarOutrasSessoes(): Promise<void> {
  const u = await usuarioDaSessao();
  const manter = await tokenAtualHash();
  if (!u || !manter) return;
  await semConta((db) => db.query('select app.revoke_other_sessions($1, $2)', [u.userId, manter]));
  await comConta(u.accountId, (db) => auditar(db, { accountId: u.accountId, userId: u.userId, acao: 'sessoes.encerrar_outras', alvoTipo: 'user', alvoId: u.userId }));
  revalidatePath('/configuracoes');
}
