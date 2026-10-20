'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { entrar } from '@/modules/accounts/acoes';
import { ESTADO_VAZIO, type EstadoFormulario } from '@/shared/ui/Formulario';

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function IconeEnvelope() {
  return (
    <svg {...svg}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}
function IconeCadeado() {
  return (
    <svg {...svg}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function IconeOlho({ aberto }: { aberto: boolean }) {
  return (
    <svg {...svg}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {!aberto && <path d="m3 3 18 18" />}
    </svg>
  );
}

/**
 * Cartão de vidro com feixes, campos com ícone e botão de revelar a senha —
 * a tela de login da V1, intacta. Sem "lembrar de mim" (a sessão tem uma
 * duração só). "Esqueci minha senha" leva à recuperação por e-mail (Fase 6).
 */
export function FormularioDeLogin({ destino, redefinida }: { destino?: string; redefinida?: boolean }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(entrar, ESTADO_VAZIO);
  const [senhaVisivel, setSenhaVisivel] = useState(false);

  return (
    <form action={acao} className="cartao-vidro" style={{ marginTop: 18 }}>
      <div className="feixes" aria-hidden="true">
        <span className="feixe feixe-h feixe-topo" />
        <span className="feixe feixe-v feixe-direita" />
        <span className="feixe feixe-h feixe-base" />
        <span className="feixe feixe-v feixe-esquerda" />
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 'var(--tipo-titulo)', fontWeight: 'var(--peso-forte)' }}>Entrar na central</h1>
          <p style={{ marginTop: 4, fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>Acesso restrito à equipe.</p>
        </div>
        {destino && <input type="hidden" name="destino" value={destino} />}
        <label className="campo">
          E-mail
          <span className="campo-login">
            <IconeEnvelope />
            <input name="email" type="email" autoComplete="username" placeholder="voce@agencia.com" required autoFocus />
          </span>
        </label>
        <label className="campo">
          Senha
          <span className="campo-login">
            <IconeCadeado />
            <input name="senha" type={senhaVisivel ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" required />
            <button
              type="button"
              className="revelar-senha"
              onClick={() => setSenhaVisivel((v) => !v)}
              aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={senhaVisivel}
            >
              <IconeOlho aberto={senhaVisivel} />
            </button>
          </span>
        </label>
        {redefinida && <p role="status" style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--ok-tx)' }}>Senha redefinida. Entre com a senha nova.</p>}
        {estado.erro && (
          <p role="alert" style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--neg-tx)' }}>
            {estado.erro}
          </p>
        )}
        <button type="submit" disabled={pendente} className="botao-primario" style={{ marginTop: 4, padding: '12px 14px', fontSize: 'var(--tipo-corpo)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          {pendente ? (
            <>
              <span className="girando" aria-hidden="true" />
              Verificando…
            </>
          ) : (
            'Entrar'
          )}
        </button>
        <Link href="/recuperar-senha" style={{ textAlign: 'center', fontSize: 'var(--tipo-apoio)' }}>Esqueci minha senha</Link>
      </div>
    </form>
  );
}
