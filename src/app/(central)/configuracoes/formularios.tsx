'use client';

import { useActionState } from 'react';
import { atualizarPerfil, trocarSenha } from '@/modules/accounts/acoes';
import { salvarNotificacoes } from '@/modules/notifications/acoes';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';

export function FormularioNotificacoes({
  prefs,
  tipos,
  provedorAtivo,
}: {
  prefs: { emailEnabled: boolean; recipients: string[]; kinds: string[] };
  /** Tipos com rótulo humano, vindos do servidor (ROTULO_ALERTA é server-only). */
  tipos: { kind: string; rotulo: string }[];
  provedorAtivo: boolean;
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(salvarNotificacoes, ESTADO_VAZIO);
  const erroDestinatarios = estado.campos?.destinatarios;
  return (
    <form action={acao} className="formulario" style={{ maxWidth: 'none' }}>
      <label style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center', fontSize: 'var(--tipo-corpo)' }}>
        <input type="checkbox" name="email_enabled" value="1" defaultChecked={prefs.emailEnabled} /> Enviar alertas por e-mail
        {!provedorAtivo && <span className="campo-dica">(sem provedor configurado: a preferência fica salva, nada é enviado)</span>}
      </label>
      <label className="campo">
        Destinatários
        <textarea
          name="destinatarios"
          rows={3}
          defaultValue={prefs.recipients.join('\n')}
          placeholder={'voce@agencia.com\nplantao@agencia.com'}
          aria-invalid={erroDestinatarios ? true : undefined}
          aria-describedby={erroDestinatarios ? 'destinatarios-erro' : 'destinatarios-dica'}
          spellCheck={false}
        />
        {erroDestinatarios ? (
          <span id="destinatarios-erro" role="alert" className="campo-erro">{erroDestinatarios}</span>
        ) : (
          <span id="destinatarios-dica" className="campo-dica">Um endereço por linha, até 10. Cada alerta vai uma vez para cada endereço.</span>
        )}
      </label>
      <fieldset style={{ border: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3) var(--esp-5)' }}>
        <legend className="campo-dica">Tipos de alerta que chegam por e-mail</legend>
        {tipos.map((t) => (
          <label key={t.kind} style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center', fontSize: 'var(--tipo-corpo)' }}>
            <input type="checkbox" name={`tipo_${t.kind}`} value="1" defaultChecked={prefs.kinds.includes(t.kind)} /> {t.rotulo}
          </label>
        ))}
      </fieldset>
      <Retorno estado={estado} />
      <div className="formulario-acoes">
        <BotaoSubmeter>Salvar notificações</BotaoSubmeter>
      </div>
    </form>
  );
}

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
