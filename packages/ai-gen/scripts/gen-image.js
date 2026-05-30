#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateImage, saveImages } from '../src/nano-banana.js';
import { makeOutDir } from '../src/out-dir.js';
import { MODELS, priceImage } from '../src/models.js';

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-image.js <prompt.yaml>');
  process.exit(1);
}

const yaml = parseYaml(await readFile(promptFile, 'utf8'));
if (!yaml.project) {
  console.error(
    `[${yaml.slug || promptFile}] missing required \`project:\` field. ` +
      'Every prompt YAML must declare its parent project (typically a reel md stem like ' +
      '20260514_what-if-cover-wont-save-you). See tools/ai-gen/prompts/_schema.md.'
  );
  process.exit(1);
}
const project = yaml.project;
const slug = yaml.slug || 'unnamed';
const model = yaml.model || 'nano-banana';
const aspect = yaml.aspect || '9:16';
const numberOfImages = yaml.count || 1;
const references = (yaml.references || []).map(p => resolve(process.cwd(), p));

console.log(`[${slug}] generating ${numberOfImages}x image via ${MODELS[model].id} (aspect ${aspect})`);
const t0 = Date.now();
const { images } = await generateImage({
  prompt: yaml.prompt,
  aspect,
  references,
  model,
  numberOfImages,
});
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

const outDir = await makeOutDir(project, slug, model);
const saved = await saveImages(images, outDir);

const unitCost = priceImage(model, yaml.resolution || '2K') ?? 0;
const manifest = {
  project,
  slug,
  promptFile,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: elapsed,
  costEstimateUSD: Number((unitCost * images.length).toFixed(3)),
  outputs: saved.map(p => p.split('/').pop()),
  params: {
    modelAlias: model,
    modelId: MODELS[model].id,
    vendor: MODELS[model].vendor,
    prompt: yaml.prompt,
    aspect,
    count: numberOfImages,
    references: yaml.references || [],
    resolution: yaml.resolution || '2K',
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
