import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { inter, jetbrainsMono } from '@/fonts';
import '@/styles/theme.css';

export const metadata: Metadata = {
  title: { default: 'JohnyWeb', template: '%s · JohnyWeb' },
  description: 'Central de acompanhamento dos sites entregues',
  manifest: '/manifest.webmanifest',
  applicationName: 'JohnyWeb',
  appleWebApp: { capable: true, title: 'JohnyWeb', statusBarStyle: 'black-translucent' },
  icons: { apple: '/apple-touch-icon.png' },
  // Central interna: nada aqui é feito para busca.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Aplica tema, efeitos e estado da barra lateral ANTES da primeira pintura.
 * Quem pede movimento reduzido no sistema começa sem efeitos, a menos que
 * tenha ligado explicitamente antes.
 */
const PREFERENCIAS = `
(function () {
  try {
    var tema = localStorage.getItem('painel:tema');
    var fx = localStorage.getItem('painel:fx');
    var menu = localStorage.getItem('painel:menu');
    var reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.dataset.tema = tema === 'claro' ? 'claro' : 'escuro';
    document.documentElement.dataset.fx = (fx === null ? !reduz : fx === 'on') ? 'on' : 'off';
    document.documentElement.dataset.menu = menu === 'recolhido' ? 'recolhido' : 'aberto';
  } catch (e) {
    document.documentElement.dataset.tema = 'escuro';
    document.documentElement.dataset.fx = 'off';
    document.documentElement.dataset.menu = 'aberto';
  }
})();
`;

export const viewport: Viewport = {
  // Cópias de `--side` (escuro) e `--side` (claro). `tools/conferir-design.mjs` vigia.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#060b07' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="pt-BR" data-tema="escuro" data-fx="off" data-menu="aberto" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PREFERENCIAS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
