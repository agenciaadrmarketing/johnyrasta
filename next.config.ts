import type { NextConfig } from 'next';

const config: NextConfig = {
  // `pg` abre sockets e lê certificados: fica fora do bundle do servidor.
  serverExternalPackages: ['pg'],
  // Não anuncia o framework em cada resposta. Não fecha porta nenhuma, mas
  // também não entrega de graça a informação que orienta a primeira tentativa.
  poweredByHeader: false,
  // Só para `next dev` acessado pelo celular na rede local: origens (IPs) liberadas para os recursos de desenvolvimento.
  allowedDevOrigins: (process.env.DEV_ORIGENS_PERMITIDAS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  // Chuva Matrix e tabelas densas: o modo estrito não muda nada em produção,
  // mas dobra efeitos em desenvolvimento e já pegou um temporizador duplicado.
  reactStrictMode: true,
  async headers() {
    return [
      {
        // O coletor é servido para os sites dos clientes (outras origens). Cache
        // curto: o arquivo é versionado no nome, mas uma correção precisa chegar.
        source: '/c.v1.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default config;
