import type { NextConfig } from 'next';

const config: NextConfig = {
  // `pg` abre sockets e lê certificados: fica fora do bundle do servidor.
  serverExternalPackages: ['pg'],
  // Não anuncia o framework em cada resposta. Não fecha porta nenhuma, mas
  // também não entrega de graça a informação que orienta a primeira tentativa.
  poweredByHeader: false,
  // Chuva Matrix e tabelas densas: o modo estrito não muda nada em produção,
  // mas dobra efeitos em desenvolvimento e já pegou um temporizador duplicado.
  reactStrictMode: true,
};

export default config;
