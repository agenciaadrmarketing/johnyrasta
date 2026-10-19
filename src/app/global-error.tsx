'use client';

import { inter, jetbrainsMono } from '@/fonts';
import { TelaDeErro } from '@/shared/ui/TelaDeErro';
import { estiloAcao } from '@/shared/ui/estilosDeErro';
import '@/styles/theme.css';

/** Falha no layout raiz: monta <html> e <body> do zero, com tema e fontes. */
export default function ErroGlobal({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR" data-tema="escuro" data-fx="off" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <TelaDeErro
          codigo="500"
          titulo="A central não conseguiu iniciar"
          descricao="O layout raiz falhou. Confira o log do servidor e as variáveis de ambiente."
          acoes={
            <button type="button" onClick={reset} style={estiloAcao(true)}>
              Tentar de novo
            </button>
          }
        />
      </body>
    </html>
  );
}
