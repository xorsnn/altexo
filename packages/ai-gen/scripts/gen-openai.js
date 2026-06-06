#!/usr/bin/env node
// Generate an image via OpenAI gpt-image-1 (DALL·E). Same YAML schema as
// gen-image.js (nano-banana) so the SAME prompt file can feed both engines for a
// clean A/B — only the engine differs. Reads OPENAI_API_KEY from .env (package
// root) or your shell environment via src/env.js.
import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { generateImage } from '../src/openai-image.js';
import { saveImages } from '../src/nano-banana.js';
import { makeOutDir } from '../src/out-dir.js';
import { priceImage } from '../src/models.js';

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-openai.js <prompt.yaml>');
  process.exit(1);
}

const yaml = parseYaml(await readFile(promptFile, 'utf8'));
if (!yaml.project) {
  console.error(`[${yaml.slug || promptFile}] missing required \`project:\` field.`);
  process.exit(1);
}
const project = yaml.project;
const slug = yaml.slug || 'unnamed';
const aspect = yaml.aspect || '9:16';
const quality = yaml.quality || 'high';
const modelId = 'gpt-image-1';

console.log(`[${slug}] generating 1x image via ${modelId} (aspect ${aspect}, quality ${quality})`);
const t0 = Date.now();
const { images, size } = await generateImage({ prompt: yaml.prompt, aspect, model: modelId, quality });
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

const outDir = await makeOutDir(project, slug, modelId);
const saved = await saveImages(images, outDir);

// Cost is quality/size-dependent; the registry carries a quality:high estimate.
const cost = (priceImage(modelId) ?? 0) * images.length;
const manifest = {
  project,
  slug,
  promptFile,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: elapsed,
  costEstimateUSD: Number(cost.toFixed(3)),
  outputs: saved.map(p => p.split('/').pop()),
  params: {
    modelId,
    vendor: 'openai',
    prompt: yaml.prompt,
    aspect,
    size, // actual pixel size gpt-image-1 produced (2:3 portrait for 9:16 input)
    quality,
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
