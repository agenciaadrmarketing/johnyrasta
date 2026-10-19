import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JohnyWeb',
    short_name: 'JohnyWeb',
    description: 'Central de acompanhamento dos sites entregues',
    start_url: '/sites',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#060b07',
    lang: 'pt-BR',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Meus sites', url: '/sites' },
      { name: 'Atenção', url: '/atencao' },
    ],
  };
}
