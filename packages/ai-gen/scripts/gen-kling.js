#!/usr/bin/env node
import '../src/cli-env.js'; // FIRST import: loads .env before env-reading modules evaluate
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateVideo, saveVideo } from '../src/kling.js';
import { createElement } from '../src/kling-elements.js';
import { makeOutDir } from '../src/out-dir.js';
import { MODELS, estimateVideoCost } from '../src/models.js';

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-kling.js <prompt.yaml>');
  process.exit(1);
}

const yaml = parseYaml(await readFile(promptFile, 'utf8'));
if (!yaml.project) {
  console.error(
    `[${yaml.slug || promptFile}] missing required \`project:\` field. ` +
      'Every prompt YAML must declare its parent project. See prompts/_schema.md.'
  );
  process.exit(1);
}
const project = yaml.project;
const slug = yaml.slug || 'unnamed';
const model = yaml.model || 'kling-master';
const aspect = yaml.aspect || '9:16';
const singleDuration = yaml.seconds || 5;
// Multi-shot: yaml.multi_shot is a list of { prompt, seconds } segments (Kling v3,
// up to 6). Total clip length is the sum and must be a valid duration for the model.
const multiShot = Array.isArray(yaml.multi_shot) ? yaml.multi_shot : null;
const shotType = yaml.shot_type || 'customize';
const totalSeconds = multiShot
  ? multiShot.reduce((s, x) => s + Number(x.seconds ?? x.duration), 0)
  : singleDuration;
const audio = yaml.audio === true; // native Kling audio (SFX/ambient/speech); off by default
const imagePath = yaml.image_input ? resolve(process.cwd(), yaml.image_input) : null;
const imageTailPath = yaml.image_tail ? resolve(process.cwd(), yaml.image_tail) : null;

// Reference subjects (elements). `element_ids:` are pre-created ids (from
// gen-kling-element.js); `elements:` is a list of { name, images:[...] } created inline.
// Reference them in the prompt as <<<element_1>>>, <<<element_2>>>, … (max 3).
const elementIds = [...(yaml.element_ids || [])];
if (Array.isArray(yaml.elements)) {
  for (const el of yaml.elements) {
    const elImgs = (el.images || []).map(p => resolve(process.cwd(), p));
    const { elementId } = await createElement({ name: el.name, description: el.description, type: el.type, imagePaths: elImgs, model });
    console.log(`[${slug}] created element "${el.name || ''}" → ${elementId}`);
    elementIds.push(elementId);
  }
}

const audioLabel = audio ? ' + audio' : '';
const shotLabel = multiShot ? ` (${multiShot.length}-shot)` : '';
const elLabel = elementIds.length ? ` + ${elementIds.length} element(s)` : '';
const modeLabel = imageTailPath
  ? `${totalSeconds}s Kling head-tail video${audioLabel}${shotLabel}${elLabel}`
  : `${totalSeconds}s Kling video${audioLabel}${shotLabel}${elLabel}`;
console.log(`[${slug}] generating ${modeLabel} via ${MODELS[model].id}`);
const t0 = Date.now();
const { videoUrl } = await generateVideo({
  prompt: yaml.prompt,
  aspect,
  duration: singleDuration,
  imagePath,
  imageTailPath,
  model,
  negativePrompt: yaml.negative_prompt,
  audio,
  multiShot,
  shotType,
  elementIds,
});
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

const outDir = await makeOutDir(project, slug, model);
const saved = await saveVideo(videoUrl, outDir);

// Native audio is billed at a multiplier (pro-tier feature) — see models.default.json.
// estimateVideoCost is the shared helper, so the CLI manifest and the library's
// generateVideo costEstimate can never drift apart.
const cost = estimateVideoCost(model, totalSeconds, { audio });
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
    seconds: totalSeconds,
    multiShot: multiShot || null,
    shotType: multiShot ? shotType : null,
    elementIds: elementIds.length ? elementIds : null,
    audio,
    imageInput: yaml.image_input || null,
    imageTail: yaml.image_tail || null,
    negativePrompt: yaml.negative_prompt || null,
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
