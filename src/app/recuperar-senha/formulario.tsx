'use client';

import { useActionState } from 'react';
import { pedirRecuperacao } from '@/modules/accounts/acoes-recuperacao';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';

export function FormularioDeRecuperacao() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(pedirRecuperacao, ESTADO_VAZIO);
  return (
    <form action={acao} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>Informe o e-mail da conta. Se ele existir, enviamos um link para criar uma senha nova.</p>
      <Campo nome="email" rotulo="E-mail" type="email" autoComplete="username" required erro={estado.campos?.email} />
      <Retorno estado={estado} />
      <BotaoSubmeter ocupado="Enviando…">Enviar link</BotaoSubmeter>
    </form>
  );
}
