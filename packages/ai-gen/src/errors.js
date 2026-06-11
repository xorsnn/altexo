// Structured error taxonomy — part of the library contract. Embedders (e.g. a
// web app rendering one tile per generation) switch on `code` to pick the UX:
// 'safety-block' → "edit & retry", 'rate-limit'/'network' → auto-retry,
// 'missing-key' → configuration error. Codes are stable API: add new ones,
// never repurpose existing ones.

export class AiGenError extends Error {
  constructor(message, { code = 'unknown', cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A required API key is absent — or the provider rejected it as invalid. */
export class MissingKeyError extends AiGenError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'missing-key' });
  }
}

/** The model returned zero images — typically a content-safety block. */
export class SafetyBlockError extends AiGenError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'safety-block' });
  }
}

/** HTTP 429 from the provider. Back off and retry. */
export class RateLimitError extends AiGenError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'rate-limit' });
  }
}

/** Transport failure or provider 5xx — transient, retry makes sense. */
export class NetworkError extends AiGenError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'network' });
  }
}

/** The caller passed bad input (unknown model, unreadable reference, bad
 * count). Deterministic — retrying without changing the input is pointless,
 * which is exactly what distinguishes it from 'unknown'. */
export class InvalidInputError extends AiGenError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'invalid-input' });
  }
}

const KNOWN_CODES = new Set([
  'missing-key', 'safety-block', 'rate-limit', 'network', 'invalid-input', 'unknown',
]);

const NETWORK_SYSCALL_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
]);

// Map an arbitrary value thrown by the provider SDK / fetch stack onto the
// taxonomy. Caller-initiated aborts and AbortSignal.timeout() expirations pass
// through untouched — they are control flow the caller started, not provider
// failures, and wrapping them would hide `err.name === 'AbortError'` checks.
// Anything unrecognized wraps as AiGenError with code 'unknown' so embedders
// can still switch exhaustively on `code`.
export function classifyError(err) {
  if (err instanceof AiGenError) return err;
  // A linked checkout and a published copy can coexist in one process (two
  // module instances); a taxonomy error built by the other copy fails the
  // instanceof check. Recognize it structurally so a correct classification
  // is never demoted to 'unknown'.
  if (err instanceof Error && KNOWN_CODES.has(err.code)) return err;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return err;

  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = err?.message ?? String(err);

  if (status === 429) return new RateLimitError(message, { cause: err });
  // 401/403: the key is rejected (revoked, rotated, wrong project). Routing
  // these to 'unknown' would let an embedder's retry loop hammer the provider
  // with a dead key.
  if (status === 401 || status === 403) return new MissingKeyError(message, { cause: err });
  if (/api[ _]?key.{0,10}(not[ _]?valid|invalid)|API_KEY_INVALID/i.test(message)) {
    return new MissingKeyError(message, { cause: err });
  }
  // 400: the provider rejected the request deterministically (bad aspect,
  // over-cap count, malformed input) — retrying unchanged is pointless.
  if (status === 400) return new InvalidInputError(message, { cause: err });
  if (status !== undefined && status >= 500) return new NetworkError(message, { cause: err });
  if (NETWORK_SYSCALL_CODES.has(err?.code) || NETWORK_SYSCALL_CODES.has(err?.cause?.code)) {
    return new NetworkError(message, { cause: err });
  }
  if (/fetch failed|socket hang up|network error/i.test(message)) {
    return new NetworkError(message, { cause: err });
  }

  return new AiGenError(message, { cause: err });
}
