'use client';

import { useActionState } from 'react';
import { criarCliente, editarCliente } from '@/modules/portfolio/acoes';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';
import type { Cliente } from '@/modules/portfolio/consultas';

export function FormularioCliente({ cliente, depois }: { cliente?: Cliente; depois?: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(cliente ? editarCliente : criarCliente, ESTADO_VAZIO);
  const c = estado.campos ?? {};
  return (
    <form action={acao} className="formulario">
      {cliente && <input type="hidden" name="id" value={cliente.id} />}
      {depois && <input type="hidden" name="depois" value={depois} />}
      <Campo nome="nome" rotulo="Nome do cliente" erro={c.nome} defaultValue={cliente?.name} required maxLength={80} placeholder="Ex.: Clínica Sol" />
      <Campo nome="notas" rotulo="Notas (opcional)" erro={c.notas} defaultValue={cliente?.notes ?? ''} maxLength={2000} placeholder="Contato, contrato, observações" />
      <Retorno estado={estado} />
      <div className="formulario-acoes">
        <BotaoSubmeter>{cliente ? 'Salvar' : depois === 'site' ? 'Cadastrar e adicionar site' : 'Cadastrar cliente'}</BotaoSubmeter>
      </div>
    </form>
  );
}
