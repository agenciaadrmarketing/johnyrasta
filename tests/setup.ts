import { config } from 'dotenv';
import { existsSync } from 'node:fs';
for (const f of ['.env.test', '.env.local']) if (existsSync(f)) config({ path: f, override: false, quiet: true });
