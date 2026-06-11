#!/usr/bin/env node
// Create a reusable Kling v3 "element" (a reference subject for character/object
// consistency) from one or more reference images, and print its element_id.
//
//   node scripts/gen-kling-element.js <name> <image1.png> [image2.png ...]
//
// Reuse the printed id in a kling prompt YAML:
//   element_ids: [<id>]      # and reference <<<element_1>>> in the prompt
import '../src/cli-env.js'; // FIRST import: loads .env before env-reading modules evaluate
import { resolve } from 'node:path';
import { createElement } from '../src/kling-elements.js';

const [name, ...imgs] = process.argv.slice(2);
if (!name || imgs.length === 0) {
  console.error('Usage: node scripts/gen-kling-element.js <name> <image1.png> [image2.png ...]');
  console.error('Creates a reusable Kling element (reference subject) and prints its element_id.');
  process.exit(1);
}

const imagePaths = imgs.map(p => resolve(process.cwd(), p));
console.log(`[element] creating "${name}" from ${imagePaths.length} reference image(s)...`);
const t0 = Date.now();
const { elementId } = await createElement({ name, imagePaths });
const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));

console.log(`[element] created in ${elapsed}s → element_id: ${elementId}`);
console.log('[element] use it in a kling YAML:');
console.log(`           element_ids: [${elementId}]`);
console.log('           # then reference <<<element_1>>> in the prompt');
