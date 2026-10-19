import { config } from 'dotenv';
import { existsSync } from 'node:fs';

/** Carrega `.env.local` e depois `.env`, sem sobrescrever o que já está no ambiente. */
export function loadEnv(): void {
  for (const arquivo of ['.env.local', '.env']) {
    if (existsSync(arquivo)) config({ path: arquivo, override: false, quiet: true });
  }
}
