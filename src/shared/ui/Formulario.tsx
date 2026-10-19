'use client';

import { useFormStatus } from 'react-dom';

/** Primitivos de formulário: todos os cadastros se comportam igual. */

export type EstadoFormulario = {
  ok?: boolean;
  erro?: string;
  campos?: Record<string, string>;
  mensagem?: string;
};

export const ESTADO_VAZIO: EstadoFormulario = {};

export function Campo({
  nome,
  rotulo,
  erro,
  dica,
  children,
  ...resto
}: {
  nome: string;
  rotulo: string;
  erro?: string;
  dica?: string;
  children?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const idErro = `${nome}-erro`;
  const idDica = `${nome}-dica`;
  return (
    <label className="campo">
      {rotulo}
      {children ?? (
        <input
          name={nome}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : dica ? idDica : undefined}
          {...resto}
        />
      )}
      {dica && !erro && (
        <span id={idDica} className="campo-dica">
          {dica}
        </span>
      )}
      {erro && (
        <span id={idErro} role="alert" className="campo-erro">
          {erro}
        </span>
      )}
    </label>
  );
}

export function Selecao({
  nome,
  rotulo,
  erro,
  dica,
  padrao,
  opcoes,
}: {
  nome: string;
  rotulo: string;
  erro?: string;
  dica?: string;
  padrao?: string;
  opcoes: { valor: string; texto: string }[];
}) {
  return (
    <Campo nome={nome} rotulo={rotulo} erro={erro} dica={dica}>
      <select name={nome} defaultValue={padrao} aria-invalid={erro ? true : undefined}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </Campo>
  );
}

/** Desabilita durante o envio: é o que impede o clique duplo de virar dois cadastros. */
export function BotaoSubmeter({ children, ocupado }: { children: React.ReactNode; ocupado?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="botao botao-primario">
      {pending ? (ocupado ?? 'Salvando…') : children}
    </button>
  );
}

export function Retorno({ estado }: { estado: EstadoFormulario }) {
  if (!estado.erro && !estado.mensagem) return null;
  const erro = !!estado.erro;
  return (
    <p
      role={erro ? 'alert' : 'status'}
      style={{
        fontSize: 'var(--tipo-apoio)',
        color: erro ? 'var(--neg-tx)' : 'var(--ok-tx)',
        background: erro ? 'var(--neg-bg)' : 'var(--ok-bg)',
        padding: '8px 12px',
        borderRadius: 'var(--raio-p)',
      }}
    >
      {estado.erro ?? estado.mensagem}
    </p>
  );
}
