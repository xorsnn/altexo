import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { requireEnv, optionalEnv } from './env.js';
import { MODELS } from './models.js';
import { downloadToFile } from './download.js';

// The international base URL moved to api-singapore.klingai.com; api.klingai.com
// still resolves for existing accounts. Override via KLING_BASE_URL (use the host
// shown in your Kling dev console) — newer endpoints may require the new host.
const BASE_URL = optionalEnv('KLING_BASE_URL', 'https://api.klingai.com');
const POLL_MS = 8_000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const TOKEN_TTL_SEC = 1800;
const MAX_SHOTS = 6; // Kling v3 multi-shot caps at 6 segments per the official examples.

function makeToken() {
  const accessKey = requireEnv('KLING_ACCESS_KEY');
  const secretKey = requireEnv('KLING_SECRET_KEY');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: accessKey, exp: now + TOKEN_TTL_SEC, nbf: now - 5 },
    secretKey,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } },
  );
}

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${makeToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(`Kling API ${res.status}: ${json.message || text}`);
  }
  return json;
}

// Submit a Kling task and poll until it succeeds or fails. Shared by every Kling
// flow (video generation, motion-control, element creation, lip-sync) so they all
// get the same auth, error handling, and timeout. Returns the succeeded
// `status.data` so callers can pull task_result.{videos,elements,...} themselves.
// `queryPath` defaults to the submit path (Kling polls `<path>/<task_id>`).
export async function submitAndPoll(submitPath, payload, { queryPath = submitPath, label = 'kling' } = {}) {
  const submit = await api('POST', submitPath, payload);
  const taskId = submit.data?.task_id;
  if (!taskId) throw new Error(`${label}: no task_id in submit response`);
  console.log(`[${label}] task ${taskId} submitted; polling...`);

  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_WAIT_MS) {
      throw new Error(`${label} task ${taskId} timed out after ${MAX_WAIT_MS / 1000}s`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
    const status = await api('GET', `${queryPath}/${taskId}`);
    const t = status.data?.task_status;
    if (t === 'succeed') return { taskId, data: status.data, raw: status };
    if (t === 'failed') {
      const msg = status.data?.task_status_msg || 'unknown';
      throw new Error(`${label} task ${taskId} failed: ${msg}`);
    }
  }
}

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
}) {
  const m = MODELS[model];
  if (!m || m.vendor !== 'kling') throw new Error(`Unknown Kling model: ${model}`);
  if (elementIds.length > 3) {
    throw new Error(`Kling supports at most 3 elements (got ${elementIds.length})`);
  }

  // Multi-shot: one clip split into up to MAX_SHOTS prompted segments. The clip's
  // total length is the SUM of the per-shot durations and must land on an allowed
  // duration for the model; the per-shot pieces themselves are free-form.
  let shots = null;
  let totalSeconds = Number(duration);
  if (multiShot != null) {
    if (!Array.isArray(multiShot) || multiShot.length === 0) {
      throw new Error('Kling multiShot must be a non-empty array of { prompt, seconds }');
    }
    if (multiShot.length > MAX_SHOTS) {
      throw new Error(`Kling multi-shot supports at most ${MAX_SHOTS} shots (got ${multiShot.length})`);
    }
    shots = multiShot.map((s, i) => {
      const secs = Number(s.seconds ?? s.duration);
      if (!Number.isFinite(secs) || secs <= 0) {
        throw new Error(`Kling multi-shot shot ${i + 1} needs a positive seconds value`);
      }
      if (!s.prompt) throw new Error(`Kling multi-shot shot ${i + 1} needs a prompt`);
      if (s.prompt.length > 512) throw new Error(`Kling multi-shot shot ${i + 1} prompt exceeds 512 chars (got ${s.prompt.length})`);
      return { index: i + 1, prompt: s.prompt, duration: String(secs) };
    });
    totalSeconds = shots.reduce((sum, s) => sum + Number(s.duration), 0);
  }

  // Allowed clip lengths are data-driven per model (models.default.json `durations`):
  // Kling 3.0 std/pro accept the integer range 3-15s; legacy tiers only 5/10.
  if (Array.isArray(m.durations) && !m.durations.includes(totalSeconds)) {
    throw new Error(`Kling model ${model} supports ${multiShot ? 'total ' : ''}durations ${m.durations.join('/')}s (got ${totalSeconds}s).`);
  }

  const isImage = !!imagePath;
  const isHeadTail = !!imageTailPath;
  if (isHeadTail && !isImage) {
    throw new Error('Kling: image_tail requires image_input (head frame) to be set');
  }
  const endpoint = isImage ? '/v1/videos/image2video' : '/v1/videos/text2video';

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
  if (isImage) {
    const data = await readFile(imagePath);
    payload.image = data.toString('base64');
  }
  if (isHeadTail) {
    const tailData = await readFile(imageTailPath);
    payload.image_tail = tailData.toString('base64');
  }

  const { taskId, data, raw } = await submitAndPoll(endpoint, payload, { label: 'kling' });
  const videos = data?.task_result?.videos ?? [];
  if (!videos.length) throw new Error('Kling: succeeded but no videos returned');
  return { videoUrl: videos[0].url, taskId, raw };
}

export async function saveVideo(videoUrl, outDir, prefix = 'video') {
  const path = `${outDir}/${prefix}-01.mp4`;
  await downloadToFile(videoUrl, path);
  return path;
}
