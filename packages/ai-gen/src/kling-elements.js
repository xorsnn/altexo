import { readFile } from 'node:fs/promises';
import { MODELS } from './models.js';
import { submitAndPoll } from './kling.js';
import { requireEnv } from './env.js';
import { InvalidInputError, MissingKeyError, classifyError } from './errors.js';

// Kling v3 reference-subject ("element") creation. An element gives the video model a
// consistent character/object across generations. Create once, then reuse the returned
// element_id via generateVideo({ elementIds }) and reference it in the prompt with
// <<<element_1>>>, <<<element_2>>>, … (positional).
//
// Official async endpoint: POST /v1/general/advanced-custom-elements (create → poll →
// element_id). Contract confirmed against the Kling dev docs (Element ▸ Create Element,
// 2026-06-07):
//   element_name        string  required  ≤ 20 chars
//   element_description string  required  ≤ 100 chars
//   reference_type      string  required  "image_refer" | "video_refer"
//   element_image_list  object  (image_refer) { frontal_image, refer_images:[{image_url}] }
//     — one frontal_image + 0–3 additional refer_images from other angles/close-ups.
//   element_video_list  object  (video_refer) { refer_videos:[{video_url}] }
//   element_voice_id    string  optional
// Images here are passed as base64 (same as image2video `image`); if the API requires a
// hosted URL instead, supply imageUrls.
//
// ## Library contract (0.11.0 — this function joined the public surface)
//
// It now meets the same contract `generateVideo` does, because a function on the surface is
// consumed by embedding servers rather than by a CLI that can afford to crash:
//
// - **Per-call `apiKey`**, falling back to `KLING_API_KEY`. An element is registered inside a
//   Kling ACCOUNT and its id resolves nowhere else, so a caller that renders under more than
//   one credential — an app covering one render with its own key and the next with a user's —
//   MUST be able to say which account an element is built in. Without this the function is
//   unusable for that case, which is the reason it was promoted.
// - **All caller input validated BEFORE keys are resolved and before any I/O.** Previously the
//   reference images were read off disk and only then counted, so an over-long list paid for
//   every read before being refused, and a bad call reported the host's key situation
//   ('missing-key') rather than its own problem.
// - **`InvalidInputError`** (code `invalid-input`) in place of bare `Error`, and provider
//   failures mapped through `classifyError` onto the taxonomy.
// - **`signal` / `timeoutMs`**, cancelling the reference reads and the poll wait alike. Aborts
//   and timeouts surface unwrapped (`err.name` `AbortError` / `TimeoutError`).
// - **Quiet by default** (`log: false`) like every other library entry point; the two CLI
//   scripts pass `log: true` to keep their submit notice.
const CREATE_PATH = '/v1/general/advanced-custom-elements';
const MAX_REFER_IMAGES = 3; // additional (non-frontal) reference images
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // element builds poll like a render; bound them alike

export async function createElement({
  name,
  description,
  imagePaths = [],
  imageUrls = [],
  type = 'image', // "image" → image_refer · "video" → video_refer
  model = 'kling-pro',
  apiKey,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = false,
  _fetch,
  _pollMs,
} = {}) {
  // --- validate caller input (before keys, before any I/O) -------------------
  const m = MODELS[model];
  if (!m) {
    throw new InvalidInputError(
      `Unknown model alias: ${model} (known: ${Object.keys(MODELS).join(', ')})`,
    );
  }
  if (m.vendor !== 'kling' || m.kind !== 'video') {
    throw new InvalidInputError(
      `Model alias '${model}' is not a Kling video model — createElement only accepts Kling video models`,
    );
  }
  if (type !== 'image' && type !== 'video') {
    throw new InvalidInputError(`createElement: type must be 'image' or 'video', got: ${type}`);
  }
  if (!Array.isArray(imagePaths) || !Array.isArray(imageUrls)) {
    throw new InvalidInputError('createElement: imagePaths and imageUrls must be arrays');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new InvalidInputError('signal must be an AbortSignal');
  }
  if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    // NaN is falsy: without this check it would silently disable the one guard against a hung
    // build; a negative value would fire instantly. Same reasoning as generateVideo.
    throw new InvalidInputError(`timeoutMs must be a non-negative finite number, got: ${timeoutMs}`);
  }

  // Count the INPUTS rather than the read bytes — that is what moves the refusal ahead of the
  // disk reads.
  const total = imagePaths.length + imageUrls.length;
  if (!total) {
    throw new InvalidInputError('createElement: provide at least one imagePath or imageUrl');
  }
  if (total > MAX_REFER_IMAGES + 1) {
    throw new InvalidInputError(
      `createElement: at most ${MAX_REFER_IMAGES + 1} images per element (1 frontal + ${MAX_REFER_IMAGES} refer); got ${total}`,
    );
  }
  if (type !== 'video' && total < 2) {
    throw new InvalidInputError(
      'createElement: an image element needs a frontal image + 1-3 reference images (≥2 images total)',
    );
  }

  // --- resolve the key (after input is known good) ---------------------------
  if (apiKey != null && (typeof apiKey !== 'string' || apiKey.trim() === '')) {
    throw new MissingKeyError(
      'An explicit apiKey was passed but is empty or not a string. ' +
        'Omit it to fall back to KLING_API_KEY.',
    );
  }
  const keys = {
    apiKey: apiKey ?? requireEnv('KLING_API_KEY', ', or pass an explicit apiKey to the call'),
  };

  // --- abort/timeout plumbing (mirrors generateVideo) ------------------------
  const timeoutCtrl = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs
    ? setTimeout(
        () => timeoutCtrl.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError')),
        timeoutMs,
      )
    : null;
  const signals = [signal, timeoutCtrl?.signal].filter(Boolean);
  const abortSignal =
    signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  try {
    // Reference reads are bounded by the same abort/timeout as the build. A read failure is a
    // deterministic caller error (bad path) → invalid-input; an abort/timeout falls through to
    // the recovery below.
    const sources = [...imageUrls];
    for (const p of imagePaths) {
      abortSignal?.throwIfAborted();
      try {
        sources.push((await readFile(p)).toString('base64'));
      } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw err;
        throw new InvalidInputError(
          `createElement: could not read reference image ${p}: ${err.message}`,
        );
      }
    }

    const payload = {
      model_name: m.id ?? 'kling-v3',
      element_name: (name || 'element').slice(0, 20),       // ≤ 20 chars
      element_description: (description || name || 'reference subject').slice(0, 100), // ≤ 100
      reference_type: type === 'video' ? 'video_refer' : 'image_refer',
    };
    if (payload.reference_type === 'image_refer') {
      payload.element_image_list = { frontal_image: sources[0] };
      if (sources.length > 1) {
        payload.element_image_list.refer_images = sources.slice(1).map((image_url) => ({ image_url }));
      }
    } else {
      payload.element_video_list = { refer_videos: sources.map((video_url) => ({ video_url })) };
    }

    const { taskId, data } = await submitAndPoll(CREATE_PATH, payload, {
      label: 'kling-element',
      signal: abortSignal,
      keys,
      fetchImpl: _fetch,
      log,
      pollMs: _pollMs,
    });
    const elementId =
      data?.task_result?.elements?.[0]?.element_id ?? data?.task_result?.element_id;
    if (!elementId) throw new Error('Kling: no element_id in advanced-custom-elements result');
    return { elementId, taskId, raw: data };
  } catch (err) {
    // fetch wraps our signal in its own controller and rejects with a generic AbortError
    // without the reason — recover the true cause from our own signals so the
    // AbortError-vs-TimeoutError distinction holds.
    if (err?.name === 'AbortError') {
      if (timeoutCtrl?.signal.aborted) throw timeoutCtrl.signal.reason;
      if (signal?.aborted) throw signal.reason ?? err;
    }
    throw classifyError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
