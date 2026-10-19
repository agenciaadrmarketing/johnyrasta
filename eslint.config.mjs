import nextConfig from 'eslint-config-next';
import nextTs from 'eslint-config-next/typescript';

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', 'public/**'],
  },
  ...nextConfig,
  ...nextTs,
  {
    rules: {
      // Aspas e apóstrofos em português aparecem o tempo todo no texto da
      // interface; escapá-los deixaria o JSX ilegível sem ganho real.
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default config;
