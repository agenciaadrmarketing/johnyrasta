import localFont from 'next/font/local';

/**
 * Fontes auto-hospedadas.
 *
 * Os arquivos são os mesmos woff2 que vieram embutidos no projeto exportado do
 * Claude Design — Inter e JetBrains Mono, ambas variáveis. Servir localmente
 * evita depender do Google Fonts em tempo de build ou de execução.
 */

export const inter = localFont({
  src: [
    { path: './inter-latin.woff2', style: 'normal' },
    { path: './inter-latin-ext.woff2', style: 'normal' },
  ],
  weight: '100 900',
  display: 'swap',
  variable: '--fonte-ui',
  fallback: ['system-ui', 'sans-serif'],
});

export const jetbrainsMono = localFont({
  src: [
    { path: './jetbrains-mono-latin.woff2', style: 'normal' },
    { path: './jetbrains-mono-latin-ext.woff2', style: 'normal' },
  ],
  weight: '100 800',
  display: 'swap',
  variable: '--fonte-mono',
  fallback: ['ui-monospace', 'monospace'],
});
