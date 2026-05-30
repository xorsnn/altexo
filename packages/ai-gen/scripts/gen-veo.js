#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateVideo, saveVideos } from '../src/veo.js';
import { makeOutDir } from '../src/out-dir.js';
import { MODELS, priceVideo } from '../src/models.js';

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-veo.js <prompt.yaml>');
  process.exit(1);
}

const yaml = parseYaml(await readFile(promptFile, 'utf8'));
if (!yaml.project) {
  console.error(
    `[${yaml.slug || promptFile}] missing required \`project:\` field. ` +
      'Every prompt YAML must declare its parent project. See tools/ai-gen/prompts/_schema.md.'
  );
  process.exit(1);
}
const project = yaml.project;
const slug = yaml.slug || 'unnamed';
const model = yaml.model || 'veo-fast';
const aspect = yaml.aspect || '9:16';
const seconds = yaml.seconds || 8;
const numberOfVideos = yaml.count || 1;
const imagePath = yaml.image_input ? resolve(process.cwd(), yaml.image_input) : null;
const imageTailPath = yaml.image_tail ? resolve(process.cwd(), yaml.image_tail) : null;

const modeLabel = imageTailPath ? `${seconds}s head-tail video` : `${seconds}s video`;
console.log(`[${slug}] generating ${numberOfVideos}x ${modeLabel} via ${MODELS[model].id}`);
console.log(`[${slug}] this typically takes 1–4 minutes per video; polling every 10s...`);
const t0 = Date.now();
const resolution = yaml.resolution || '1080p';
const { videos } = await generateVideo({
  prompt: yaml.prompt,
  aspect,
  seconds,
  imagePath,
  imageTailPath,
  model,
  numberOfVideos,
  generateAudio: yaml.audio !== false,
  resolution,
});
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

const outDir = await makeOutDir(project, slug, model);
const saved = await saveVideos(videos, outDir);

const unitCost = priceVideo(model, seconds) ?? 0;
const manifest = {
  project,
  slug,
  promptFile,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: elapsed,
  costEstimateUSD: Number((unitCost * numberOfVideos).toFixed(2)),
  outputs: saved.map(p => p.split('/').pop()),
  params: {
    modelAlias: model,
    modelId: MODELS[model].id,
    vendor: MODELS[model].vendor,
    prompt: yaml.prompt,
    aspect,
    seconds,
    resolution,
    count: numberOfVideos,
    imageInput: yaml.image_input || null,
    imageTail: yaml.image_tail || null,
    audio: yaml.audio !== false,
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
