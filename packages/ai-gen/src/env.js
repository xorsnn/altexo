import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { MissingKeyError } from './errors.js';

// Load the package-local .env (gitignored). Keys can also come from the real
// environment (CI, shell exports) — those take precedence over the file.
const here = dirname(fileURLToPath(import.meta.url));
const localEnv = resolve(here, '../.env');
if (existsSync(localEnv)) loadEnv({ path: localEnv });

// Library contract: THROW on a missing key, never process.exit. This package
// runs embedded in long-lived servers; exit(1) here would take the host down
// with it. CLI entry points get a non-zero exit from the uncaught throw.
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new MissingKeyError(
      `Missing required env var: ${name}. ` +
        'Set it in .env (copy .env.example), export it in your shell, ' +
        'or pass an explicit apiKey to the call.'
    );
  }
  return value;
}

export function optionalEnv(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
