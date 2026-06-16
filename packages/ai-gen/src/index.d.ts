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
  /** Kling video alias from MODELS (default 'kling-master'). */
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
  /** Per-call Kling access key; falls back to KLING_ACCESS_KEY. */
  accessKey?: string;
  /** Per-call Kling secret key; falls back to KLING_SECRET_KEY. */
  secretKey?: string;
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
