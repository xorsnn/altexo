// Stable library surface of @altexo/ai-gen — import from the package root,
// never from deep src/* paths. This is the embedding contract: image
// generation (Nano Banana), video generation (Kling), the model/pricing
// registry, and the error taxonomy. Off the surface until hardened to the same
// contract: Veo (veo.js) and the OpenAI image generator (openai-image.js —
// note it exports its own, incompatible `generateImage`; when it joins the
// surface it will need a rename or a provider dispatch, not a re-export).
// Importing this module has no side effects: no .env loading, no process.env
// mutation (the CLI entry points load .env explicitly via loadLocalEnv).

export { generateImage, saveImages, extractImages } from './nano-banana.js';
export { generateVideo, saveVideo } from './kling.js';
export { MODELS, priceImage, priceVideo, estimateImageCost, estimateVideoCost } from './models.js';
export {
  AiGenError,
  MissingKeyError,
  SafetyBlockError,
  RateLimitError,
  NetworkError,
  InvalidInputError,
  classifyError,
} from './errors.js';
