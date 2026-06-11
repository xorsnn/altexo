// Stable library surface of @altexo/ai-gen — import from the package root,
// never from deep src/* paths. This is the embedding contract: image
// generation (Nano Banana), the model/pricing registry, and the error
// taxonomy. The video generators (veo, kling) remain CLI-first and are not
// part of the library surface yet; they join here once hardened to the same
// contract (per-call keys, abort, taxonomy).

export { generateImage, saveImages, extractImages } from './nano-banana.js';
export { MODELS, priceImage, priceVideo } from './models.js';
export {
  AiGenError,
  MissingKeyError,
  SafetyBlockError,
  RateLimitError,
  NetworkError,
  classifyError,
} from './errors.js';
