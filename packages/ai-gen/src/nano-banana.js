import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { requireEnv } from './env.js';
import { MODELS, estimateImageCost } from './models.js';
import {
  AiGenError,
  MissingKeyError,
  SafetyBlockError,
  InvalidInputError,
  classifyError,
} from './errors.js';

function mimeFor(ext) {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  throw new InvalidInputError(`Unsupported image extension: ${ext}`);
}

async function partFromFile(path, signal) {
  const data = await readFile(path, signal ? { signal } : undefined);
  return {
    inlineData: {
      mimeType: mimeFor(extname(path)),
      data: data.toString('base64'),
    },
  };
}

// Pure parse of a provider response into [{ mimeType, data: Buffer }].
// Exported so the response→images contract is testable offline.
export function extractImages(response) {
  const images = [];
  for (const candidate of response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push({
          mimeType: part.inlineData.mimeType,
          data: Buffer.from(part.inlineData.data, 'base64'),
        });
      }
    }
  }
  return images;
}

// Library contract (stable):
//   generateImage({ prompt, aspect, references, model, numberOfImages,
//                   apiKey, signal, timeoutMs })
//     → { images: [{ mimeType, data: Buffer }], modelId, costEstimate }
//
// - All caller input is validated BEFORE the key is resolved and before any
//   I/O, so a bad call reports its own problem ('invalid-input'), not the
//   host's key situation ('missing-key').
// - `apiKey` is per-call; falls back to GEMINI_API_KEY. Missing both — or an
//   explicit apiKey that is empty/not a string — throws MissingKeyError.
// - `signal` (AbortSignal) cancels the call INCLUDING the reference-file
//   reads; `timeoutMs` (default 120s, 0 to disable) bounds the whole thing so
//   a hung request or a blocking read can't pin a caller forever. Aborts and
//   timeouts surface unwrapped (err.name 'AbortError' / 'TimeoutError').
// - Zero returned images throws SafetyBlockError; provider/transport failures
//   map onto the errors.js taxonomy. The raw provider payload is never leaked.
// - `costEstimate` is USD at the default 2K resolution, images.length × unit
//   (the provider may return fewer than numberOfImages; cost reflects actual).
// - `_client` is a test seam: injects a fake in place of the GoogleGenAI
//   instance so the full path is testable offline. Not public API.
export async function generateImage({
  prompt,
  aspect = '9:16',
  references = [],
  model = 'nano-banana',
  numberOfImages = 1,
  apiKey,
  signal,
  timeoutMs = 120_000,
  _client,
}) {
  if (apiKey != null && (typeof apiKey !== 'string' || apiKey.trim() === '')) {
    // An empty string is not nullish — without this check it would skip the
    // env fallback AND sail past the missing-key gate into the SDK.
    throw new MissingKeyError(
      'An explicit apiKey was passed but is empty or not a string. ' +
        'Omit it to fall back to GEMINI_API_KEY.'
    );
  }
  if (!Number.isInteger(numberOfImages) || numberOfImages < 1) {
    throw new InvalidInputError(
      `numberOfImages must be a positive integer, got: ${numberOfImages}`
    );
  }
  if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    // NaN is falsy: without this check it would silently disable the one
    // guard against a hung request; a negative value would fire instantly.
    throw new InvalidInputError(`timeoutMs must be a non-negative finite number, got: ${timeoutMs}`);
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new InvalidInputError('signal must be an AbortSignal');
  }
  const entry = MODELS[model];
  if (!entry) {
    throw new InvalidInputError(
      `Unknown model alias: ${model} (known: ${Object.keys(MODELS).join(', ')})`
    );
  }
  if (entry.kind !== 'image') {
    throw new InvalidInputError(
      `Model alias '${model}' is a ${entry.kind} model — generateImage only accepts image models`
    );
  }
  const key = apiKey ?? requireEnv('GEMINI_API_KEY', ', or pass an explicit apiKey to the call');
  const modelId = entry.id;
  // vertexai: false pins the Gemini API backend — without it the SDK sniffs
  // GOOGLE_GENAI_USE_VERTEXAI from the host env and could silently reroute
  // an embedder's calls to Vertex with a Gemini API key.
  const ai = _client ?? new GoogleGenAI({ apiKey: key, vertexai: false });

  // Manual timeout controller instead of AbortSignal.timeout: the timer is
  // cleared the moment the call settles (no stale 120s timers under parallel
  // tile generation), and the TimeoutError reason stays inspectable below.
  // Built BEFORE the reference reads so those are bounded too.
  const timeoutCtrl = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs
    ? setTimeout(
        () =>
          timeoutCtrl.abort(
            new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError')
          ),
        timeoutMs
      )
    : null;
  const signals = [signal, timeoutCtrl?.signal].filter(Boolean);
  const abortSignal =
    signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  let response;
  try {
    let refParts;
    try {
      refParts = await Promise.all(references.map((p) => partFromFile(p, abortSignal)));
    } catch (err) {
      // Aborts/timeouts fall through to the outer recovery; everything else
      // here is a deterministic caller error (unreadable path, bad extension).
      if (err instanceof AiGenError || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw err;
      }
      throw new InvalidInputError(`Could not read reference image: ${err.message}`, {
        cause: err,
      });
    }
    const parts = [...refParts, { text: prompt }];

    response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: aspect },
        candidateCount: numberOfImages,
        abortSignal,
        httpOptions: timeoutMs ? { timeout: timeoutMs } : undefined,
      },
    });
  } catch (err) {
    // The SDK wraps our signal in its own AbortController and aborts WITHOUT
    // forwarding the reason — every abort reaches us as a generic AbortError.
    // Recover the true cause from our own signals so the documented
    // AbortError-vs-TimeoutError distinction actually holds through the SDK.
    if (err?.name === 'AbortError') {
      if (timeoutCtrl?.signal.aborted) throw timeoutCtrl.signal.reason;
      if (signal?.aborted) throw signal.reason ?? err;
    }
    throw classifyError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const images = extractImages(response);
  if (!images.length) {
    const reason =
      response.promptFeedback?.blockReason ??
      response.candidates?.[0]?.finishReason ??
      'no image data in response';
    throw new SafetyBlockError(
      `Model returned no images (${reason}) — usually a content-safety block ` +
        'on the prompt or reference images. Rephrase and retry.'
    );
  }

  return {
    images,
    modelId,
    costEstimate: estimateImageCost(model, images.length),
  };
}

const EXT_FOR_MIME = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function saveImages(images, outDir, prefix = 'img') {
  if (/[/\\]|\.\./.test(prefix)) {
    // The mimeType-derived extension can't traverse (no '/' in a mime
    // subtype survives the allowlist), so prefix is the only injectable part.
    throw new InvalidInputError(`prefix must be a bare file-name fragment, got: ${prefix}`);
  }
  await mkdir(outDir, { recursive: true });
  const paths = images.map((img, i) => {
    const ext = EXT_FOR_MIME[img.mimeType] ?? 'png';
    return `${outDir}/${prefix}-${String(i + 1).padStart(2, '0')}.${ext}`;
  });
  // 'wx': names are deterministic, so a reused outDir would silently
  // overwrite a sibling generation's tiles — fail loudly instead.
  // allSettled: every write has settled before this returns or throws, so a
  // caller's cleanup/retry never races half-finished writes.
  const results = await Promise.allSettled(
    images.map((img, i) => writeFile(paths[i], img.data, { flag: 'wx' }))
  );
  const firstFailure = results.find((r) => r.status === 'rejected');
  if (firstFailure) throw firstFailure.reason;
  return paths;
}
