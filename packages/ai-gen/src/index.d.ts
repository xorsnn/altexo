// Hand-maintained declarations for the stable library surface (src/index.js).
// Keep in lockstep with the exports there — this file IS the compile-time
// contract embedders rely on.

export type AiGenErrorCode =
  | 'missing-key'
  | 'safety-block'
  | 'rate-limit'
  /** The provider ACCOUNT has no funds left (0.10.0). Split out of 'rate-limit'
   * because Kling answers HTTP 429 for both. Never auto-retry it — a throttle
   * clears itself, this one only clears when somebody pays. */
  | 'insufficient-balance'
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
export class InsufficientBalanceError extends AiGenError {
  code: 'insufficient-balance';
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

export interface MultiShotSegment {
  prompt: string;
  /** Segment length in seconds (alias: `duration`). The segments sum to the clip length. */
  seconds?: number;
  duration?: number;
}

export interface GenerateVideoOptions {
  prompt: string;
  /** e.g. '9:16' (default), '1:1', '16:9' */
  aspect?: string;
  /** Clip length in seconds (default 5). Validated against the model's allowed `durations`. */
  duration?: number;
  /** Head frame for image-to-video; omit for text-to-video. Server-trusted path. */
  imagePath?: string | null;
  /** Tail frame; requires `imagePath`. Server-trusted path. */
  imageTailPath?: string | null;
  /** Kling video alias from MODELS (default 'kling-std'). */
  model?: string;
  negativePrompt?: string;
  /** Native Kling audio (pro tier, single start frame). Billed at the model's audioMultiplier. */
  audio?: boolean;
  /** Split one clip into ≤6 prompted segments; their seconds sum to the clip length. */
  multiShot?: MultiShotSegment[] | null;
  /** 'customize' (default) honors the list; 'intelligence' auto-storyboards. */
  shotType?: 'customize' | 'intelligence';
  /** ≤3 reference-subject ids from createElement(). */
  elementIds?: string[];
  /** Per-call Kling API key, sent as the bearer token; falls back to KLING_API_KEY. */
  apiKey?: string;
  /** Cancels the call; surfaces unwrapped with err.name === 'AbortError'. */
  signal?: AbortSignal;
  /** Bound on the call in ms (default 600000; 0 disables). Expiry surfaces
   * unwrapped with err.name === 'TimeoutError'. */
  timeoutMs?: number;
}

export interface GenerateVideoResult {
  /** URL of the rendered clip (download with saveVideo). */
  videoUrl: string;
  /** Provider task id — record it to resume/observe the render. */
  taskId: string;
  modelId: string;
  /** USD: priceVideo × audio multiplier. */
  costEstimate: number;
  /** Clip length actually rendered (the multi-shot sum, if any). */
  durationSeconds: number;
  aspect: string;
}

export function generateVideo(options: GenerateVideoOptions): Promise<GenerateVideoResult>;

/**
 * A Kling reference subject ("element") — a character or object the video model holds
 * consistent across a clip. Built once, then passed to `generateVideo({ elementIds })` and
 * referenced positionally in the prompt as `<<<element_1>>>`.
 */
export interface CreateElementOptions {
  /** Element name, truncated to Kling's 20-char limit. Defaults to 'element'. */
  name?: string;
  /** Description, truncated to 100 chars. Defaults to `name`. */
  description?: string;
  /** Reference images read from disk. First is the frontal; the rest are other angles. */
  imagePaths?: string[];
  /** Reference sources already base64-encoded (or hosted URLs), same order rule. */
  imageUrls?: string[];
  /** 'image' (default) builds from stills; 'video' builds from 3-8s reference clips. */
  type?: 'image' | 'video';
  /** Kling video model alias from MODELS (default 'kling-pro'). */
  model?: string;
  /**
   * Per-call Kling API key; falls back to KLING_API_KEY. An element exists only inside the
   * account that created it, so a caller rendering under more than one credential must pass
   * the same key here that it will pass to generateVideo.
   */
  apiKey?: string;
  /** Cancels the build INCLUDING the reference reads; surfaces unwrapped as 'AbortError'. */
  signal?: AbortSignal;
  /** Bound in ms (default 600000; 0 disables). Expiry surfaces unwrapped as 'TimeoutError'. */
  timeoutMs?: number;
  /** Print the submit/poll notice (default false — library calls are quiet). */
  log?: boolean;
}

export interface CreateElementResult {
  /** Pass to generateVideo({ elementIds: [elementId] }). Account-scoped: it resolves under
   * the key that created it and nowhere else. */
  elementId: string;
  /** Provider task id for the create-and-poll job. */
  taskId: string;
  /** The raw provider task result. */
  raw: unknown;
}

/**
 * Register a reference subject with Kling. An image element needs a frontal image plus 1-3
 * more (2-4 total); a video element takes reference clips. All input is validated before the
 * key is resolved and before any file is read.
 */
export function createElement(options: CreateElementOptions): Promise<CreateElementResult>;

export interface ValidateKlingApiKeyOptions {
  /** The Kling API key to check. Per-call only — there is NO env fallback here. */
  apiKey: string;
  /** Cancels the probe. An abort lands as `unavailable`, never as a throw. */
  signal?: AbortSignal;
  /** Bound on the probe in ms (default 8000; 0 disables). A timeout lands as
   * `unavailable`, never as a throw. */
  timeoutMs?: number;
}

export type KlingKeyValidation =
  /** The provider accepted the credential. */
  | { status: 'valid' }
  /** The provider looked at this credential and refused it (401/403), or it is
   * structurally unusable. Safe to act on — e.g. to demote a stored key. */
  | { status: 'invalid'; message: string }
  /** No verdict: an outage, a timeout, a 429, an abort. NEVER treat as a bad key. */
  | { status: 'unavailable'; message: string };

/**
 * Check whether a Kling API key is live, without submitting a render.
 *
 * One cheap authenticated GET against the caller's own task list — non-mutating and
 * unbilled. NEVER throws: an unusable credential is a verdict, not an exception, so
 * the result can be consumed without a try/catch. The provider's response body is
 * never echoed into `message`, so a result is always safe to log.
 */
export function validateKlingApiKey(
  options: ValidateKlingApiKeyOptions
): Promise<KlingKeyValidation>;

/** Downloads videoUrl to outDir/<prefix>-01.mp4. Returns the written path. */
export function saveVideo(videoUrl: string, outDir: string, prefix?: string): Promise<string>;

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
export function estimateVideoCost(
  model: string,
  seconds: number,
  opts?: { audio?: boolean }
): number;
