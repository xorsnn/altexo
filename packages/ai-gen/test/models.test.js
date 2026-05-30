// Offline unit tests for the model registry + pricing. No network, no API keys.
// Run with `npm test` (node --test) or `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODELS, priceImage, priceVideo } from '../src/models.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('registry exposes the expected aliases with id/vendor/kind', () => {
  for (const alias of [
    'nano-banana', 'nano-banana-flash', 'veo', 'veo-fast',
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
});

test('video pricing — perSecond models and per-duration tables', () => {
  approx(priceVideo('veo', 8), 3.2);        // 0.40/s
  approx(priceVideo('veo-fast', 8), 1.2);   // 0.15/s (audio-on basis, see note)
  assert.equal(priceVideo('kling-pro', 5), 0.42);
  assert.equal(priceVideo('kling-pro', 10), 0.84);
  assert.equal(priceVideo('kling-master', 5), 0.70);
  assert.equal(priceVideo('kling-std', 5), 0.21);
});

test('unknown model or duration prices to null (no silent zero)', () => {
  assert.equal(priceImage('does-not-exist'), null);
  assert.equal(priceVideo('does-not-exist', 5), null);
  assert.equal(priceVideo('kling-pro', 7), null); // 7s not in the table
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
