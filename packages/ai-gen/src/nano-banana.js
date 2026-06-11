import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { requireEnv } from './env.js';
import { MODELS, priceImage } from './models.js';
import { AiGenError, SafetyBlockError, classifyError } from './errors.js';

function mimeFor(ext) {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  throw new AiGenError(`Unsupported image extension: ${ext}`);
}

async function partFromFile(path) {
  const data = await readFile(path);
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
  for (const candidate of response.candidates ?? []) {
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
// - `apiKey` is per-call; falls back to GEMINI_API_KEY. Missing both throws
//   MissingKeyError before any network I/O.
// - `signal` (AbortSignal) cancels the call; `timeoutMs` (default 120s) bounds
//   it so a hung request can't pin a caller forever. Aborts/timeouts surface
//   unwrapped (err.name 'AbortError' / 'TimeoutError').
// - Zero returned images throws SafetyBlockError; provider/transport failures
//   map onto the errors.js taxonomy. The raw provider payload is never leaked.
// - `costEstimate` is USD at the default 2K resolution, images.length × unit.
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
  const key = apiKey ?? requireEnv('GEMINI_API_KEY');
  const entry = MODELS[model];
  if (!entry) {
    throw new AiGenError(
      `Unknown model alias: ${model} (known: ${Object.keys(MODELS).join(', ')})`
    );
  }
  const modelId = entry.id;
  const ai = _client ?? new GoogleGenAI({ apiKey: key });

  const parts = [];
  for (const refPath of references) parts.push(await partFromFile(refPath));
  parts.push({ text: prompt });

  const signals = [];
  if (signal) signals.push(signal);
  if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
  const abortSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  let response;
  try {
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
    throw classifyError(err);
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

  const unitCost = priceImage(model) ?? 0;
  return {
    images,
    modelId,
    costEstimate: Number((unitCost * images.length).toFixed(3)),
  };
}

export async function saveImages(images, outDir, prefix = 'img') {
  const paths = [];
  for (let i = 0; i < images.length; i++) {
    const ext = (images[i].mimeType || 'image/png').split('/')[1];
    const path = `${outDir}/${prefix}-${String(i + 1).padStart(2, '0')}.${ext}`;
    await writeFile(path, images[i].data);
    paths.push(path);
  }
  return paths;
}
