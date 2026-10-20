import { config } from 'dotenv';
import { existsSync } from 'node:fs';

/**
 * Carrega variáveis para os scripts, sem sobrescrever o que já está no ambiente.
 *
 *   ENV_FILE=.env.supabase npm run db:supabase-preflight   → lê SÓ esse arquivo (um ambiente alternativo,
 *                                                           sem tocar no .env.local do banco de desenvolvimento)
 *   (sem ENV_FILE)                                          → `.env.local` e depois `.env`, como sempre
 */
export function loadEnv(): void {
  const escolhido = (process.env.ENV_FILE ?? '').trim();
  if (escolhido) {
    if (!existsSync(escolhido)) throw new Error(`ENV_FILE aponta para um arquivo que não existe: ${escolhido}`);
    config({ path: escolhido, override: false, quiet: true });
    return;
  }
  for (const arquivo of ['.env.local', '.env']) {
    if (existsSync(arquivo)) config({ path: arquivo, override: false, quiet: true });
  }
}
