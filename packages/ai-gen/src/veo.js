import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { requireEnv } from './env.js';
import { MODELS } from './models.js';
import { downloadToFile } from './download.js';

function mimeFor(ext) {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  throw new Error(`Unsupported image extension: ${ext}`);
}

const POLL_MS = 10_000;
const MAX_WAIT_MS = 10 * 60 * 1000;

export async function generateVideo({
  prompt,
  aspect = '9:16',
  seconds = 8,
  imagePath = null,
  imageTailPath = null,
  model = 'veo-fast',
  numberOfVideos = 1,
  generateAudio = true,
  resolution = '1080p',
}) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const modelId = MODELS[model].id;
  const ai = new GoogleGenAI({ apiKey });

  // generateAudio is a Vertex-only param — the Gemini API rejects it and always
  // generates native audio with the video. Silently ignore the flag here.
  void generateAudio;
  const request = {
    model: modelId,
    prompt,
    config: {
      aspectRatio: aspect,
      durationSeconds: seconds,
      numberOfVideos,
      resolution,
    },
  };

  if (imagePath) {
    const data = await readFile(imagePath);
    request.image = {
      imageBytes: data.toString('base64'),
      mimeType: mimeFor(extname(imagePath)),
    };
  }
  if (imageTailPath) {
    if (!imagePath) {
      throw new Error('Veo: lastFrame (image_tail) requires image (image_input) to be set');
    }
    const tailData = await readFile(imageTailPath);
    request.config.lastFrame = {
      imageBytes: tailData.toString('base64'),
      mimeType: mimeFor(extname(imageTailPath)),
    };
  }

  let operation = await ai.models.generateVideos(request);
  const start = Date.now();
  while (!operation.done) {
    if (Date.now() - start > MAX_WAIT_MS) {
      throw new Error(`Veo operation timed out after ${MAX_WAIT_MS / 1000}s`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const generated = operation.response?.generatedVideos ?? [];
  if (!generated.length) {
    const detail = JSON.stringify(operation.response ?? {}, null, 2).slice(0, 2000);
    throw new Error(`Veo returned no videos. Most common cause: safety filter rejection. Operation response:\n${detail}`);
  }

  return {
    videos: generated.map(v => {
      const uri = v.video.uri;
      const sep = uri.includes('?') ? '&' : '?';
      return { uri, downloadUri: `${uri}${sep}key=${apiKey}` };
    }),
    raw: operation,
  };
}

export async function saveVideos(videos, outDir, prefix = 'video') {
  const paths = [];
  for (let i = 0; i < videos.length; i++) {
    const path = `${outDir}/${prefix}-${String(i + 1).padStart(2, '0')}.mp4`;
    await downloadToFile(videos[i].downloadUri, path);
    paths.push(path);
  }
  return paths;
}
