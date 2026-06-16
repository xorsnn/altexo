// Offline unit tests for the model registry + pricing. No network, no API keys.
// Run with `npm test` (node --test) or `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODELS, priceImage, priceVideo, estimateVideoCost } from '../src/models.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('registry exposes the expected aliases with id/vendor/kind', () => {
  for (const alias of [
    'nano-banana', 'nano-banana-flash', 'gpt-image-1', 'veo', 'veo-fast',
    'kling-master', 'kling-pro', 'kling-std',
  ]) {
    const m = MODELS[alias];
    assert.ok(m, `missing model ${alias}`);
    assert.equal(typeof m.id, 'string');
    assert.equal(typeof m.vendor, 'string');
    assert.ok(m.kind === 'image' || m.kind === 'video');
  }
});

test('the JSON _comment key is stripped (never looks like a model)', () => {
  assert.equal('_comment' in MODELS, false);
});

test('image pricing — incl. the corrected Nano Banana Pro 1K rate', () => {
  assert.equal(priceImage('nano-banana', '1K'), 0.134); // M01 fix: was 0.039 (a Flash copy-paste)
  assert.equal(priceImage('nano-banana', '2K'), 0.134); // 2K is the default resolution
  assert.equal(priceImage('nano-banana'), 0.134);       // defaults to 2K
  assert.equal(priceImage('nano-banana', '4K'), 0.24);
  assert.equal(priceImage('nano-banana-flash'), 0.039); // perImage path, resolution-agnostic
  assert.equal(priceImage('gpt-image-1'), 0.25);        // OpenAI engine, perImage path
  assert.equal(MODELS['gpt-image-1'].vendor, 'openai');
});

test('kling-pro carries a 2x native-audio multiplier', () => {
  assert.equal(MODELS['kling-pro'].audioMultiplier, 2);
  // The CLIs / consumers bill audio as priceVideo * audioMultiplier.
  approx(priceVideo('kling-pro', 5) * MODELS['kling-pro'].audioMultiplier, 0.84);
});

test('Kling 3 exposes the 3-15s duration set; legacy master stays 5/10', () => {
  const v3 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  assert.deepEqual(MODELS['kling-pro'].durations, v3);
  assert.deepEqual(MODELS['kling-std'].durations, v3);
  assert.deepEqual(MODELS['kling-master'].durations, [5, 10]);
});

test('video pricing — all video models bill per-second (Kling 3 over 3-15s)', () => {
  approx(priceVideo('veo', 8), 3.2);          // 0.40/s
  approx(priceVideo('veo-fast', 8), 1.2);     // 0.15/s (audio-on basis, see note)
  approx(priceVideo('kling-pro', 5), 0.42);   // 0.084/s — matches the legacy 5s point
  approx(priceVideo('kling-pro', 10), 0.84);  // ...and the legacy 10s point
  approx(priceVideo('kling-pro', 7), 0.588);  // any 3-15s length now prices linearly
  approx(priceVideo('kling-pro', 15), 1.26);
  approx(priceVideo('kling-master', 5), 0.70);
  approx(priceVideo('kling-std', 5), 0.21);
});

test('estimateVideoCost rounds, applies the audio multiplier, zeroes unknowns', () => {
  approx(estimateVideoCost('kling-pro', 5), 0.42);                       // silent
  approx(estimateVideoCost('kling-pro', 5, { audio: true }), 0.84);      // ×2 audio multiplier
  approx(estimateVideoCost('kling-std', 5, { audio: true }), 0.21);      // no multiplier declared → ×1
  assert.equal(estimateVideoCost('does-not-exist', 5), 0);              // unknown → 0, like estimateImageCost
});

test('unknown model prices to null (no silent zero)', () => {
  assert.equal(priceImage('does-not-exist'), null);
  assert.equal(priceVideo('does-not-exist', 5), null);
  // Video models are all per-second now, so any numeric duration resolves to a
  // price; only an unknown model yields null. (Duration validity is enforced by
  // each model's `durations` set in the generator, not by pricing.)
});

test('AI_GEN_MODELS_CONFIG override does per-model shallow replace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aigen-override-'));
  const file = join(dir, 'override.json');
  writeFileSync(file, JSON.stringify({
    'kling-pro': { vendor: 'kling', id: 'kling-v9', mode: 'pro', kind: 'video', pricing: { '5': 9.99 } },
    'brand-new': { vendor: 'acme', id: 'acme-1', kind: 'image', pricing: { '1K': 1.0 } },
  }));

  process.env.AI_GEN_MODELS_CONFIG = file;
  try {
    // Cache-bust query → fresh module eval that reads the env var at load time.
    const m = await import('../src/models.js?case=override');
    assert.equal(m.MODELS['kling-pro'].id, 'kling-v9');        // existing entry replaced wholesale
    assert.equal(m.priceVideo('kling-pro', 5), 9.99);          // ...including its pricing
    assert.equal(m.MODELS['brand-new'].id, 'acme-1');          // new alias added
    assert.equal(m.MODELS['veo'].id, 'veo-3.1-generate-preview'); // unmentioned default kept
  } finally {
    delete process.env.AI_GEN_MODELS_CONFIG;
  }
});

test('a bad override path throws (misconfig surfaces immediately)', async () => {
  process.env.AI_GEN_MODELS_CONFIG = '/no/such/override-file.json';
  try {
    await assert.rejects(() => import('../src/models.js?case=badpath'));
  } finally {
    delete process.env.AI_GEN_MODELS_CONFIG;
  }
});
