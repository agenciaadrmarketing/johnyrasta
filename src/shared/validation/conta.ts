import { SENHA_MINIMA } from '@/modules/accounts/password';

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && email.length <= 254;
}

export function validarSenha(senha: string): string | null {
  if (senha.length < SENHA_MINIMA) return `A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > 200) return 'Senha longa demais.';
  return null;
}
