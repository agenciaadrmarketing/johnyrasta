'use client';

import Link from 'next/link';
import { TelaDeErro } from '@/shared/ui/TelaDeErro';
import { estiloAcao } from '@/shared/ui/estilosDeErro';

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <TelaDeErro
      codigo="500"
      titulo="Falha ao montar esta tela"
      descricao="A central não conseguiu renderizar. A causa mais comum é a conexão com o banco; o motivo exato está no log do servidor."
      detalhe={
        error.digest ? (
          <p className="mono" style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
            Ocorrência: {error.digest}
          </p>
        ) : undefined
      }
      acoes={
        <>
          <button type="button" onClick={reset} style={estiloAcao(true)}>
            Tentar de novo
          </button>
          <Link href="/sites" style={estiloAcao(false)}>
            Ir para Meus sites
          </Link>
        </>
      }
    />
  );
}
