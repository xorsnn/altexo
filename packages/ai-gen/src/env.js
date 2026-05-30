import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load the package-local .env (gitignored). Keys can also come from the real
// environment (CI, shell exports) — those take precedence over the file.
const here = dirname(fileURLToPath(import.meta.url));
const localEnv = resolve(here, '../.env');
if (existsSync(localEnv)) loadEnv({ path: localEnv });

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    console.error('Set it in .env (copy .env.example) or export it in your shell.');
    process.exit(1);
  }
  return value;
}
