// Offline tests for the library contract: no network, no API keys.
// Run with `npm test` (node --test).
//
// The contract under test (see README "Library usage"):
//   - requireEnv THROWS on a missing key — never process.exit (regression:
//     0.4.0 exited, which would kill an embedding server).
//   - generateImage accepts a per-call apiKey, an AbortSignal, a timeout, and
//     returns the stable shape { images: [{ mimeType, data }], modelId,
//     costEstimate } — never the raw provider payload.
//   - Failures map onto the error taxonomy: missing-key / safety-block /
//     rate-limit / network; aborts pass through unwrapped.
//   - The package root is importable via the exports map.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateImage, extractImages } from '../src/nano-banana.js';
import { requireEnv } from '../src/env.js';
import { MODELS, priceImage } from '../src/models.js';
import {
  AiGenError,
  MissingKeyError,
  SafetyBlockError,
  RateLimitError,
  NetworkError,
  classifyError,
} from '../src/errors.js';

// --- fixtures -------------------------------------------------------------

const pngBase64 = Buffer.from('fake-png-bytes').toString('base64');
const imagePart = { inlineData: { mimeType: 'image/png', data: pngBase64 } };
const responseWith = (parts, extra = {}) => ({
  candidates: [{ content: { parts } }],
  ...extra,
});

// A stand-in for the GoogleGenAI instance (the `_client` test seam).
const fakeClient = (impl) => ({ models: { generateContent: impl } });

// Run a block with GEMINI_API_KEY guaranteed absent, restoring it after.
async function withoutGeminiKey(fn) {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
}

// --- throw, never exit (THE regression test) -------------------------------

test('missing env var THROWS MissingKeyError — process survives (was process.exit(1))', () => {
  delete process.env.AI_GEN_TEST_NOT_SET;
  assert.throws(() => requireEnv('AI_GEN_TEST_NOT_SET'), MissingKeyError);
  assert.throws(() => requireEnv('AI_GEN_TEST_NOT_SET'), /Missing required env var/);
  // Reaching this line is the point: under 0.4.0 the first call would have
  // terminated the test runner before either assertion resolved.
  assert.equal(requireEnv.name, 'requireEnv');
});

test('generateImage with no key anywhere rejects missing-key before any I/O', async () => {
  await withoutGeminiKey(async () => {
    await assert.rejects(generateImage({ prompt: 'a red square' }), (e) => {
      assert.ok(e instanceof MissingKeyError);
      assert.equal(e.code, 'missing-key');
      return true;
    });
  });
});

// --- per-call apiKey + stable return shape ---------------------------------

test('per-call apiKey skips env; returns { images, modelId, costEstimate }', async () => {
  await withoutGeminiKey(async () => {
    let seen;
    const client = fakeClient(async (req) => {
      seen = req;
      return responseWith([imagePart, imagePart]);
    });

    const result = await generateImage({
      prompt: 'two variants',
      numberOfImages: 2,
      apiKey: 'per-call-key',
      _client: client,
    });

    // Request wiring
    assert.equal(seen.model, MODELS['nano-banana'].id);
    assert.equal(seen.config.candidateCount, 2);
    assert.equal(seen.config.imageConfig.aspectRatio, '9:16');
    assert.ok(seen.config.abortSignal instanceof AbortSignal, 'abort signal always wired');
    assert.equal(seen.config.httpOptions.timeout, 120_000);
    assert.deepEqual(seen.contents[0].parts.at(-1), { text: 'two variants' });

    // Return shape — exactly the contract, no raw payload leak
    assert.deepEqual(Object.keys(result).sort(), ['costEstimate', 'images', 'modelId']);
    assert.equal(result.modelId, MODELS['nano-banana'].id);
    assert.equal(result.images.length, 2);
    assert.equal(result.images[0].mimeType, 'image/png');
    assert.deepEqual(result.images[0].data, Buffer.from('fake-png-bytes'));
    assert.equal(result.costEstimate, Number((priceImage('nano-banana') * 2).toFixed(3)));
  });
});

test('unknown model alias throws AiGenError, not a TypeError', async () => {
  await assert.rejects(
    generateImage({ prompt: 'x', model: 'no-such-model', apiKey: 'k' }),
    (e) => e instanceof AiGenError && /Unknown model alias/.test(e.message)
  );
});

// --- error taxonomy through generateImage ----------------------------------

test('zero images from the model → SafetyBlockError (code safety-block)', async () => {
  const client = fakeClient(async () =>
    responseWith([], { promptFeedback: { blockReason: 'SAFETY' } })
  );
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: client }),
    (e) => {
      assert.ok(e instanceof SafetyBlockError);
      assert.equal(e.code, 'safety-block');
      assert.match(e.message, /SAFETY/);
      return true;
    }
  );
});

test('provider 429 → RateLimitError (code rate-limit), original kept as cause', async () => {
  const apiErr = Object.assign(new Error('quota exceeded'), { status: 429 });
  const client = fakeClient(async () => { throw apiErr; });
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: client }),
    (e) => {
      assert.ok(e instanceof RateLimitError);
      assert.equal(e.code, 'rate-limit');
      assert.equal(e.cause, apiErr);
      return true;
    }
  );
});

test('transport failure → NetworkError (code network)', async () => {
  const netErr = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }),
  });
  const client = fakeClient(async () => { throw netErr; });
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: client }),
    (e) => e instanceof NetworkError && e.code === 'network'
  );
});

test('caller abort passes through unwrapped (err.name === AbortError)', async () => {
  const abortErr = new DOMException('The operation was aborted.', 'AbortError');
  const client = fakeClient(async () => { throw abortErr; });
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: client }),
    (e) => {
      assert.equal(e, abortErr); // identical object — not wrapped
      assert.equal(e.name, 'AbortError');
      return true;
    }
  );
});

// --- classifyError unit coverage -------------------------------------------

test('classifyError maps the taxonomy and falls back to code unknown', () => {
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 429 })).code, 'rate-limit');
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 503 })).code, 'network');
  assert.equal(classifyError(new Error('API key not valid. Please pass a valid API key.')).code, 'missing-key');
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).code, 'network');
  assert.equal(classifyError(new Error('something novel')).code, 'unknown');
  assert.equal(classifyError(new Error('something novel')) instanceof AiGenError, true);

  const mine = new SafetyBlockError('already classified');
  assert.equal(classifyError(mine), mine); // idempotent
  const timeout = new DOMException('timed out', 'TimeoutError');
  assert.equal(classifyError(timeout), timeout); // timeouts pass through too
});

// --- extractImages parsing ---------------------------------------------------

test('extractImages: parses inlineData parts, skips text parts, [] on empty', () => {
  const mixed = responseWith([{ text: 'caption' }, imagePart]);
  const images = extractImages(mixed);
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].data, Buffer.from('fake-png-bytes'));

  assert.deepEqual(extractImages({}), []);
  assert.deepEqual(extractImages({ candidates: [] }), []);
});

// --- exports map -------------------------------------------------------------

test('package root import (exports map) exposes the full library surface', async () => {
  const api = await import('@altexo/ai-gen'); // self-reference via package.json exports
  for (const name of [
    'generateImage', 'saveImages', 'extractImages',
    'MODELS', 'priceImage', 'priceVideo',
    'AiGenError', 'MissingKeyError', 'SafetyBlockError', 'RateLimitError',
    'NetworkError', 'classifyError',
  ]) {
    assert.ok(name in api, `missing export: ${name}`);
  }
  assert.equal(typeof api.generateImage, 'function');
  assert.ok(api.MODELS['nano-banana']);
});
