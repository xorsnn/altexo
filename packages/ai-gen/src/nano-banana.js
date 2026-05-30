import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { requireEnv } from './env.js';
import { MODELS } from './models.js';

function mimeFor(ext) {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  throw new Error(`Unsupported image extension: ${ext}`);
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

export async function generateImage({
  prompt,
  aspect = '9:16',
  references = [],
  model = 'nano-banana',
  numberOfImages = 1,
}) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const modelId = MODELS[model].id;
  const ai = new GoogleGenAI({ apiKey });

  const parts = [];
  for (const refPath of references) parts.push(await partFromFile(refPath));
  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: aspect },
      candidateCount: numberOfImages,
    },
  });

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
  if (!images.length) throw new Error('Nano Banana returned no image data');
  return { images, raw: response };
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
