// Hand-maintained declarations for the stable library surface (src/index.js).
// Keep in lockstep with the exports there — this file IS the compile-time
// contract embedders rely on.

export type AiGenErrorCode =
  | 'missing-key'
  | 'safety-block'
  | 'rate-limit'
  | 'network'
  | 'invalid-input'
  | 'unknown';

export class AiGenError extends Error {
  constructor(message: string, opts?: { code?: AiGenErrorCode; cause?: unknown });
  code: AiGenErrorCode;
  cause?: unknown;
}
export class MissingKeyError extends AiGenError {
  code: 'missing-key';
}
export class SafetyBlockError extends AiGenError {
  code: 'safety-block';
}
export class RateLimitError extends AiGenError {
  code: 'rate-limit';
}
export class NetworkError extends AiGenError {
  code: 'network';
}
export class InvalidInputError extends AiGenError {
  code: 'invalid-input';
}

/** Maps an arbitrary thrown value onto the taxonomy. Aborts/timeouts pass
 * through unwrapped; unrecognized values wrap as AiGenError code 'unknown'. */
export function classifyError(err: unknown): Error;

export interface GeneratedImage {
  mimeType: string;
  data: Buffer;
}

export interface GenerateImageOptions {
  prompt: string;
  /** e.g. '9:16' (default), '1:1', '16:9' */
  aspect?: string;
  /** Image file paths read from disk — must be server-trusted, never raw user input. */
  references?: string[];
  /** Model alias from MODELS (default 'nano-banana'). */
  model?: string;
  /** Positive integer (default 1). */
  numberOfImages?: number;
  /** Per-call key; falls back to GEMINI_API_KEY when omitted. */
  apiKey?: string;
  /** Cancels the call; surfaces unwrapped with err.name === 'AbortError'. */
  signal?: AbortSignal;
  /** Bound on the call in ms (default 120000; 0 disables). Expiry surfaces
   * unwrapped with err.name === 'TimeoutError'. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  modelId: string;
  /** USD at the default 2K rate × images actually returned. */
  costEstimate: number;
}

export function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult>;

/** Writes images to outDir (created if missing). prefix must be a bare
 * file-name fragment. Returns the written paths. */
export function saveImages(
  images: GeneratedImage[],
  outDir: string,
  prefix?: string
): Promise<string[]>;

/** Pure parse of a provider response into images. */
export function extractImages(response: unknown): GeneratedImage[];

export interface ModelEntry {
  id: string;
  vendor: string;
  kind: 'image' | 'video';
  pricing: Record<string, number>;
  [key: string]: unknown;
}

export const MODELS: Record<string, ModelEntry>;
export function priceImage(model: string, resolution?: string): number | null;
export function priceVideo(model: string, seconds: number): number | null;
export function estimateImageCost(model: string, count: number, resolution?: string): number;
