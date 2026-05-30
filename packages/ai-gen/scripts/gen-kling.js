#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateVideo, saveVideo } from '../src/kling.js';
import { makeOutDir } from '../src/out-dir.js';
import { MODELS, priceVideo } from '../src/models.js';

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-kling.js <prompt.yaml>');
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
const model = yaml.model || 'kling-master';
const aspect = yaml.aspect || '9:16';
const duration = yaml.seconds || 5;
const imagePath = yaml.image_input ? resolve(process.cwd(), yaml.image_input) : null;
const imageTailPath = yaml.image_tail ? resolve(process.cwd(), yaml.image_tail) : null;

const modeLabel = imageTailPath ? `${duration}s Kling head-tail video` : `${duration}s Kling video`;
console.log(`[${slug}] generating ${modeLabel} via ${MODELS[model].id}`);
const t0 = Date.now();
const { videoUrl } = await generateVideo({
  prompt: yaml.prompt,
  aspect,
  duration,
  imagePath,
  imageTailPath,
  model,
  negativePrompt: yaml.negative_prompt,
});
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

const outDir = await makeOutDir(project, slug, model);
const saved = await saveVideo(videoUrl, outDir);

const cost = priceVideo(model, duration) ?? 0;
const manifest = {
  project,
  slug,
  promptFile,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: elapsed,
  costEstimateUSD: Number(cost.toFixed(2)),
  outputs: [saved.split('/').pop()],
  params: {
    modelAlias: model,
    modelId: MODELS[model].id,
    mode: MODELS[model].mode || null,
    vendor: MODELS[model].vendor,
    prompt: yaml.prompt,
    aspect,
    seconds: duration,
    imageInput: yaml.image_input || null,
    imageTail: yaml.image_tail || null,
    negativePrompt: yaml.negative_prompt || null,
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
