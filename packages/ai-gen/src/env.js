import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { MissingKeyError } from './errors.js';

// Load the package-local .env (gitignored). Keys can also come from the real
// environment (CI, shell exports) — those take precedence over the file.
//
// CLI-only, and EXPLICIT: the CLI entry points (scripts/*) call this at
// startup. It must never run as an import side effect — importing the library
// in a server would silently inject every key from a dev checkout's .env into
// the host's process.env, and the published tarball ships no .env, so the
// behavior would differ between linked and published installs.
export function loadLocalEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const localEnv = resolve(here, '../.env');
  if (existsSync(localEnv)) loadEnv({ path: localEnv });
}

// Library contract: THROW on a missing key, never process.exit. This package
// runs embedded in long-lived servers; exit(1) here would take the host down
// with it. CLI entry points get a non-zero exit from the uncaught throw.
// `hint` lets a call site append advice that only applies to it (e.g. only
// generateImage accepts a per-call apiKey).
export function requireEnv(name, hint = '') {
  const value = process.env[name];
  if (!value) {
    throw new MissingKeyError(
      `Missing required env var: ${name}. ` +
        `Set it in .env (copy .env.example) or export it in your shell${hint}.`
    );
  }
  return value;
}

export function optionalEnv(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
