import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { requireEnv } from './env.js';
import { MODELS } from './models.js';
import { downloadToFile } from './download.js';

const BASE_URL = 'https://api.klingai.com';
const POLL_MS = 8_000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const TOKEN_TTL_SEC = 1800;

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

export async function generateVideo({
  prompt,
  aspect = '9:16',
  duration = 5,
  imagePath = null,
  imageTailPath = null,
  model = 'kling-master',
  negativePrompt,
  audio = false,
}) {
  const m = MODELS[model];
  if (!m || m.vendor !== 'kling') throw new Error(`Unknown Kling model: ${model}`);
  // Allowed clip lengths are data-driven per model (models.default.json `durations`):
  // Kling 3.0 std/pro accept the integer range 3-15s; legacy tiers only 5/10.
  if (Array.isArray(m.durations) && !m.durations.includes(Number(duration))) {
    throw new Error(`Kling model ${model} supports durations ${m.durations.join('/')}s (got ${duration}s).`);
  }
  const isImage = !!imagePath;
  const isHeadTail = !!imageTailPath;
  if (isHeadTail && !isImage) {
    throw new Error('Kling: image_tail requires image_input (head frame) to be set');
  }
  const endpoint = isImage ? '/v1/videos/image2video' : '/v1/videos/text2video';

  const payload = {
    model_name: m.id,
    prompt,
    duration: String(duration),
    aspect_ratio: aspect,
    cfg_scale: 0.5,
  };
  if (m.mode) payload.mode = m.mode;
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  // Native audio (synced SFX / ambient). The OFFICIAL Kling API field is `sound`
  // (string "on"/"off"), NOT the `enable_audio` boolean used by third-party
  // wrappers. Image-to-video audio needs PRO mode and a single start frame (it is
  // unavailable with an end frame); billed at a multiplier (see
  // models.default.json `audioMultiplier`).
  if (audio) payload.sound = 'on';
  if (isImage) {
    const data = await readFile(imagePath);
    payload.image = data.toString('base64');
  }
  if (isHeadTail) {
    const tailData = await readFile(imageTailPath);
    payload.image_tail = tailData.toString('base64');
  }

  const submit = await api('POST', endpoint, payload);
  const taskId = submit.data?.task_id;
  if (!taskId) throw new Error('Kling: no task_id in submit response');
  console.log(`[kling] task ${taskId} submitted; polling...`);

  const start = Date.now();
  while (true) {
    if (Date.now() - start > MAX_WAIT_MS) {
      throw new Error(`Kling task ${taskId} timed out after ${MAX_WAIT_MS / 1000}s`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
    const status = await api('GET', `${endpoint}/${taskId}`);
    const t = status.data?.task_status;
    if (t === 'succeed') {
      const videos = status.data?.task_result?.videos ?? [];
      if (!videos.length) throw new Error('Kling: succeeded but no videos returned');
      return { videoUrl: videos[0].url, taskId, raw: status };
    }
    if (t === 'failed') {
      const msg = status.data?.task_status_msg || 'unknown';
      throw new Error(`Kling task ${taskId} failed: ${msg}`);
    }
  }
}

export async function saveVideo(videoUrl, outDir, prefix = 'video') {
  const path = `${outDir}/${prefix}-01.mp4`;
  await downloadToFile(videoUrl, path);
  return path;
}
