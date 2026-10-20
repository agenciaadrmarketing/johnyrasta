'use client';

import { useActionState } from 'react';
import { redefinirSenha } from '@/modules/accounts/acoes-recuperacao';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';

export function FormularioDeRedefinicao({ token }: { token: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(redefinirSenha, ESTADO_VAZIO);
  return (
    <form action={acao} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <Campo nome="nova" rotulo="Senha nova" type="password" autoComplete="new-password" required erro={estado.campos?.nova} dica="Mínimo de 10 caracteres." />
      <Campo nome="confirmacao" rotulo="Repita a senha" type="password" autoComplete="new-password" required erro={estado.campos?.confirmacao} />
      <Retorno estado={estado} />
      <BotaoSubmeter ocupado="Salvando…">Redefinir senha</BotaoSubmeter>
    </form>
  );
}
