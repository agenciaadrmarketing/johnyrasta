'use client';

import { useActionState } from 'react';
import { atualizarPerfil, trocarSenha } from '@/modules/accounts/acoes';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';

export function FormularioPerfil({ nome, email }: { nome: string; email: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(atualizarPerfil, ESTADO_VAZIO);
  return (
    <form action={acao} className="formulario">
      <Campo nome="nome" rotulo="Seu nome" erro={estado.campos?.nome} defaultValue={nome} required maxLength={80} />
      <Campo nome="email" rotulo="E-mail de acesso" defaultValue={email} disabled dica="Troca de e-mail exige confirmação por e-mail; chega com o provedor (Fase 5)." />
      <Retorno estado={estado} />
      <div className="formulario-acoes">
        <BotaoSubmeter>Salvar nome</BotaoSubmeter>
      </div>
    </form>
  );
}

export function FormularioSenha() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(trocarSenha, ESTADO_VAZIO);
  const c = estado.campos ?? {};
  return (
    <form action={acao} className="formulario">
      <Campo nome="atual" rotulo="Senha atual" type="password" autoComplete="current-password" erro={c.atual} required />
      <Campo nome="nova" rotulo="Nova senha" type="password" autoComplete="new-password" erro={c.nova} required dica="Mínimo de 10 caracteres." />
      <Campo nome="confirmacao" rotulo="Confirmar nova senha" type="password" autoComplete="new-password" erro={c.confirmacao} required />
      <Retorno estado={estado} />
      <div className="formulario-acoes">
        <BotaoSubmeter ocupado="Alterando…">Alterar senha</BotaoSubmeter>
      </div>
    </form>
  );
}
