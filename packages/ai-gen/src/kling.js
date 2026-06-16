import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { requireEnv, optionalEnv } from './env.js';
import { MODELS, estimateVideoCost } from './models.js';
import { downloadToFile } from './download.js';
import {
  AiGenError,
  MissingKeyError,
  InvalidInputError,
  classifyError,
} from './errors.js';

// The international base URL moved to api-singapore.klingai.com; api.klingai.com
// still resolves for existing accounts. Override via KLING_BASE_URL (use the host
// shown in your Kling dev console) — newer endpoints may require the new host.
const BASE_URL = optionalEnv('KLING_BASE_URL', 'https://api.klingai.com');
const POLL_MS = 8_000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = MAX_WAIT_MS; // Kling renders take minutes; bound it like generateImage.
const TOKEN_TTL_SEC = 1800;
const MAX_SHOTS = 6; // Kling v3 multi-shot caps at 6 segments per the official examples.

// Mint a fresh 30-min JWT per request (a single render polls past one token's
// TTL). Keys are resolved per-call so an embedder can pass them explicitly;
// `keys` omitted falls back to the env, preserving the CLI/deep-caller path.
function makeToken(keys) {
  const accessKey = keys?.accessKey ?? requireEnv('KLING_ACCESS_KEY');
  const secretKey = keys?.secretKey ?? requireEnv('KLING_SECRET_KEY');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: accessKey, exp: now + TOKEN_TTL_SEC, nbf: now - 5 },
    secretKey,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } },
  );
}

async function api(method, path, body, { signal, keys, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${makeToken(keys)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || (json.code != null && json.code !== 0)) {
    // Carry the HTTP status so classifyError() routes 429/401/403/400/5xx onto
    // the taxonomy (rate-limit / missing-key / invalid-input / network) instead
    // of collapsing every provider failure to 'unknown'.
    const err = new Error(`Kling API ${res.status}: ${json.message || text}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// A setTimeout that an AbortSignal can cut short — so a cancel/timeout during
// the inter-poll wait resolves immediately instead of stalling up to POLL_MS.
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

// Submit a Kling task and poll until it succeeds or fails. Shared by every Kling
// flow (video generation, motion-control, element creation, lip-sync) so they all
// get the same auth, error handling, and cancellation. Returns the succeeded
// `status.data` so callers can pull task_result.{videos,elements,...} themselves.
// `queryPath` defaults to the submit path (Kling polls `<path>/<task_id>`).
// `signal` cancels the submit, the polls, and the inter-poll wait; `keys` and
// `fetchImpl` are threaded to api(); `log` (default true, for the CLI) prints a
// one-line submit notice — pass false to keep an embedding server quiet.
export async function submitAndPoll(
  submitPath,
  payload,
  { queryPath = submitPath, label = 'kling', signal, keys, fetchImpl = fetch, log = true, pollMs = POLL_MS } = {},
) {
  const submit = await api('POST', submitPath, payload, { signal, keys, fetchImpl });
  const taskId = submit.data?.task_id;
  if (!taskId) throw new Error(`${label}: no task_id in submit response`);
  if (log) console.log(`[${label}] task ${taskId} submitted; polling...`);

  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_WAIT_MS) {
      throw new Error(`${label} task ${taskId} timed out after ${MAX_WAIT_MS / 1000}s`);
    }
    await abortableSleep(pollMs, signal);
    const status = await api('GET', `${queryPath}/${taskId}`, undefined, { signal, keys, fetchImpl });
    const t = status.data?.task_status;
    if (t === 'succeed') return { taskId, data: status.data, raw: status };
    if (t === 'failed') {
      const msg = status.data?.task_status_msg || 'unknown';
      throw new Error(`${label} task ${taskId} failed: ${msg}`);
    }
  }
}

// Library contract (stable, mirrors generateImage):
//   generateVideo({ prompt, aspect, duration, imagePath, imageTailPath, model,
//                   negativePrompt, audio, multiShot, shotType, elementIds,
//                   accessKey, secretKey, signal, timeoutMs })
//     → { videoUrl, taskId, modelId, costEstimate, durationSeconds, aspect }
//
// - All caller input is validated BEFORE keys are resolved and before any I/O,
//   so a bad call reports its own problem ('invalid-input'), not the host's key
//   situation ('missing-key').
// - `accessKey`/`secretKey` are per-call; each falls back to its env var
//   (KLING_ACCESS_KEY / KLING_SECRET_KEY). An explicit empty/non-string value
//   throws MissingKeyError before any I/O.
// - `signal` (AbortSignal) cancels the call INCLUDING the head/tail file reads
//   and the poll wait; `timeoutMs` (default 600s — renders take minutes — 0 to
//   disable) bounds the whole thing. Aborts/timeouts surface unwrapped
//   (err.name 'AbortError' / 'TimeoutError').
// - Provider/transport failures map onto the errors.js taxonomy; the raw
//   provider payload is never returned.
// - `_fetch` is a test seam (injects a fake in place of global fetch so the
//   full submit→poll path is testable offline). Not public API.
export async function generateVideo({
  prompt,
  aspect = '9:16',
  duration = 5,
  imagePath = null,
  imageTailPath = null,
  model = 'kling-master',
  negativePrompt,
  audio = false,
  multiShot = null,
  shotType = 'customize',
  elementIds = [],
  accessKey,
  secretKey,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _fetch,
  _pollMs,
}) {
  // --- validate caller input (before keys, before any I/O) -----------------
  const m = MODELS[model];
  if (!m) {
    throw new InvalidInputError(
      `Unknown model alias: ${model} (known: ${Object.keys(MODELS).join(', ')})`,
    );
  }
  if (m.vendor !== 'kling' || m.kind !== 'video') {
    throw new InvalidInputError(
      `Model alias '${model}' is not a Kling video model — generateVideo only accepts Kling video models`,
    );
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new InvalidInputError('signal must be an AbortSignal');
  }
  if (timeoutMs != null && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    // NaN is falsy: without this check it would silently disable the one guard
    // against a hung render; a negative value would fire instantly.
    throw new InvalidInputError(`timeoutMs must be a non-negative finite number, got: ${timeoutMs}`);
  }
  if (!Array.isArray(elementIds)) {
    throw new InvalidInputError('elementIds must be an array of element id strings');
  }
  if (elementIds.length > 3) {
    throw new InvalidInputError(`Kling supports at most 3 elements (got ${elementIds.length})`);
  }

  // Multi-shot: one clip split into up to MAX_SHOTS prompted segments. The clip's
  // total length is the SUM of the per-shot durations and must land on an allowed
  // duration for the model; the per-shot pieces themselves are free-form.
  let shots = null;
  let totalSeconds = Number(duration);
  if (multiShot != null) {
    if (!Array.isArray(multiShot) || multiShot.length === 0) {
      throw new InvalidInputError('Kling multiShot must be a non-empty array of { prompt, seconds }');
    }
    if (multiShot.length > MAX_SHOTS) {
      throw new InvalidInputError(`Kling multi-shot supports at most ${MAX_SHOTS} shots (got ${multiShot.length})`);
    }
    shots = multiShot.map((s, i) => {
      const secs = Number(s.seconds ?? s.duration);
      if (!Number.isFinite(secs) || secs <= 0) {
        throw new InvalidInputError(`Kling multi-shot shot ${i + 1} needs a positive seconds value`);
      }
      if (!s.prompt) throw new InvalidInputError(`Kling multi-shot shot ${i + 1} needs a prompt`);
      if (s.prompt.length > 512) throw new InvalidInputError(`Kling multi-shot shot ${i + 1} prompt exceeds 512 chars (got ${s.prompt.length})`);
      return { index: i + 1, prompt: s.prompt, duration: String(secs) };
    });
    totalSeconds = shots.reduce((sum, s) => sum + Number(s.duration), 0);
  }

  // Allowed clip lengths are data-driven per model (models.default.json `durations`):
  // Kling 3.0 std/pro accept the integer range 3-15s; legacy tiers only 5/10.
  if (Array.isArray(m.durations) && !m.durations.includes(totalSeconds)) {
    throw new InvalidInputError(`Kling model ${model} supports ${multiShot ? 'total ' : ''}durations ${m.durations.join('/')}s (got ${totalSeconds}s).`);
  }

  const isImage = !!imagePath;
  const isHeadTail = !!imageTailPath;
  if (isHeadTail && !isImage) {
    throw new InvalidInputError('Kling: image_tail (tail frame) requires imagePath (head frame) to be set');
  }

  // --- resolve keys (after input is known good) ----------------------------
  for (const [name, val] of [['accessKey', accessKey], ['secretKey', secretKey]]) {
    if (val != null && (typeof val !== 'string' || val.trim() === '')) {
      throw new MissingKeyError(
        `An explicit ${name} was passed but is empty or not a string. ` +
          `Omit it to fall back to ${name === 'accessKey' ? 'KLING_ACCESS_KEY' : 'KLING_SECRET_KEY'}.`,
      );
    }
  }
  const keys = {
    accessKey: accessKey ?? requireEnv('KLING_ACCESS_KEY', ', or pass an explicit accessKey to the call'),
    secretKey: secretKey ?? requireEnv('KLING_SECRET_KEY', ', or pass an explicit secretKey to the call'),
  };

  // --- abort/timeout plumbing (mirrors generateImage) ----------------------
  // Manual timeout controller instead of AbortSignal.timeout: the timer is
  // cleared the moment the call settles, and the TimeoutError reason stays
  // inspectable so the abort-vs-timeout distinction survives below.
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
    const payload = {
      model_name: m.id,
      prompt: prompt || '',
      duration: String(totalSeconds),
      aspect_ratio: aspect,
      cfg_scale: 0.5,
    };
    if (m.mode) payload.mode = m.mode;
    if (negativePrompt) payload.negative_prompt = negativePrompt;
    if (shots) {
      // Official multi-shot fields: a single top-level duration (the sum) plus the
      // per-shot prompt/duration list. shot_type "customize" honors the list as-is;
      // "intelligence" lets Kling auto-storyboard. Reference shots in the prompt as
      // <<<shot_1>>> etc. if needed.
      payload.multi_shot = true;
      payload.shot_type = shotType;
      payload.multi_prompt = shots;
    }
    if (elementIds.length) {
      // Reference subjects for character/object consistency. element_ids come from
      // createElement() (advanced-custom-elements). Reference them in the prompt as
      // <<<element_1>>>, <<<element_2>>>, … positionally.
      payload.element_list = elementIds.map(element_id => ({ element_id }));
    }
    // Native audio (synced SFX / ambient). The OFFICIAL Kling API field is `sound`
    // (string "on"/"off"), NOT the `enable_audio` boolean used by third-party
    // wrappers. Image-to-video audio needs PRO mode and a single start frame
    // (not available with an end frame); billed at a multiplier
    // (see models.default.json `audioMultiplier`).
    if (audio) payload.sound = 'on';

    // Head/tail reads are bounded by the same abort/timeout as the render. A
    // read failure is a deterministic caller error (bad path) → invalid-input;
    // an abort/timeout falls through to the recovery below.
    try {
      if (isImage) {
        const data = await readFile(imagePath, abortSignal ? { signal: abortSignal } : undefined);
        payload.image = data.toString('base64');
      }
      if (isHeadTail) {
        const tailData = await readFile(imageTailPath, abortSignal ? { signal: abortSignal } : undefined);
        payload.image_tail = tailData.toString('base64');
      }
    } catch (err) {
      if (err instanceof AiGenError || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw err;
      }
      throw new InvalidInputError(`Could not read frame image: ${err.message}`, { cause: err });
    }

    const endpoint = isImage ? '/v1/videos/image2video' : '/v1/videos/text2video';
    const { taskId, data } = await submitAndPoll(endpoint, payload, {
      label: 'kling',
      signal: abortSignal,
      keys,
      fetchImpl: _fetch ?? fetch,
      log: false,
      ...(_pollMs != null ? { pollMs: _pollMs } : {}),
    });
    const videos = data?.task_result?.videos ?? [];
    if (!videos.length) throw new Error('Kling: succeeded but no videos returned');

    return {
      videoUrl: videos[0].url,
      taskId,
      modelId: m.id,
      costEstimate: estimateVideoCost(model, totalSeconds, { audio }),
      durationSeconds: totalSeconds,
      aspect,
    };
  } catch (err) {
    // fetch wraps our signal in its own controller and rejects with a generic
    // AbortError without the reason — recover the true cause from our own
    // signals so the AbortError-vs-TimeoutError distinction holds.
    if (err?.name === 'AbortError') {
      if (timeoutCtrl?.signal.aborted) throw timeoutCtrl.signal.reason;
      if (signal?.aborted) throw signal.reason ?? err;
    }
    throw classifyError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function saveVideo(videoUrl, outDir, prefix = 'video') {
  const path = `${outDir}/${prefix}-01.mp4`;
  await downloadToFile(videoUrl, path);
  return path;
}
