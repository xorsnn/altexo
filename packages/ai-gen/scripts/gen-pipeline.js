#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateImage, saveImages } from '../src/nano-banana.js';
import * as veo from '../src/veo.js';
import * as kling from '../src/kling.js';
import { makeOutDir } from '../src/out-dir.js';
import { MODELS, priceImage, priceVideo } from '../src/models.js';
import { loadLocalEnv } from '../src/env.js';

loadLocalEnv(); // CLI mode: pull keys from the package-local .env

const promptFile = process.argv[2];
if (!promptFile) {
  console.error('Usage: node scripts/gen-pipeline.js <pipeline.yaml>');
  process.exit(1);
}

const cfg = parseYaml(await readFile(promptFile, 'utf8'));
if (!cfg.project) {
  console.error(
    `[${cfg.slug || promptFile}] missing required \`project:\` field. ` +
      'Every prompt YAML must declare its parent project. See tools/ai-gen/prompts/_schema.md.'
  );
  process.exit(1);
}
const project = cfg.project;
const slug = cfg.slug || 'pipeline';

const imgCfg = cfg.image;
const vidCfg = cfg.video;
const imgModel = imgCfg.model || 'nano-banana';
const vidModel = vidCfg.model || 'veo-fast';
const aspect = cfg.aspect || imgCfg.aspect || '9:16';

const outDir = await makeOutDir(project, slug, `${imgModel}+${vidModel}`);

console.log(`[${slug}] step 1/2: image via ${MODELS[imgModel].id}`);
const t0 = Date.now();
const { images } = await generateImage({
  prompt: imgCfg.prompt,
  aspect: imgCfg.aspect || aspect,
  references: (imgCfg.references || []).map(p => resolve(process.cwd(), p)),
  model: imgModel,
  numberOfImages: 1,
});
const [heroFrame] = await saveImages(images, outDir, 'hero');
console.log(`[${slug}] hero frame → ${heroFrame}`);

const seconds = vidCfg.seconds || 8;
console.log(`[${slug}] step 2/2: ${seconds}s video via ${MODELS[vidModel].id}`);

let savedVideo;
let costVideo;
if (vidModel.startsWith('kling')) {
  const { videoUrl } = await kling.generateVideo({
    prompt: vidCfg.prompt,
    aspect: vidCfg.aspect || aspect,
    duration: seconds,
    imagePath: heroFrame,
    model: vidModel,
  });
  savedVideo = await kling.saveVideo(videoUrl, outDir);
  costVideo = priceVideo(vidModel, seconds) ?? 0;
} else {
  const { videos } = await veo.generateVideo({
    prompt: vidCfg.prompt,
    aspect: vidCfg.aspect || aspect,
    seconds,
    imagePath: heroFrame,
    model: vidModel,
  });
  const [videoPath] = await veo.saveVideos(videos, outDir);
  savedVideo = videoPath;
  costVideo = priceVideo(vidModel, seconds) ?? 0;
}

const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));
const imgCost = priceImage(imgModel, '2K') ?? 0;

const manifest = {
  project,
  slug,
  promptFile,
  generatedAt: new Date().toISOString(),
  elapsedSeconds: elapsed,
  costEstimateUSD: Number((imgCost + costVideo).toFixed(2)),
  outputs: [heroFrame.split('/').pop(), savedVideo.split('/').pop()],
  pipeline: {
    image: {
      modelAlias: imgModel,
      modelId: MODELS[imgModel].id,
      vendor: MODELS[imgModel].vendor,
      prompt: imgCfg.prompt,
      aspect: imgCfg.aspect || aspect,
      output: heroFrame.split('/').pop(),
    },
    video: {
      modelAlias: vidModel,
      modelId: MODELS[vidModel].id,
      mode: MODELS[vidModel].mode || null,
      vendor: MODELS[vidModel].vendor,
      prompt: vidCfg.prompt,
      aspect: vidCfg.aspect || aspect,
      seconds,
      output: savedVideo.split('/').pop(),
    },
  },
};
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));

console.log(`[${slug}] done in ${elapsed}s → ${outDir}`);
console.log(`[${slug}] est cost: $${manifest.costEstimateUSD}`);
