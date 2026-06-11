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
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateImage, extractImages, saveImages } from '../src/nano-banana.js';
import { requireEnv, optionalEnv } from '../src/env.js';
import { MODELS, priceImage, estimateImageCost } from '../src/models.js';
import {
  AiGenError,
  MissingKeyError,
  SafetyBlockError,
  RateLimitError,
  NetworkError,
  InvalidInputError,
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
    'MODELS', 'priceImage', 'priceVideo', 'estimateImageCost',
    'AiGenError', 'MissingKeyError', 'SafetyBlockError', 'RateLimitError',
    'NetworkError', 'InvalidInputError', 'classifyError',
  ]) {
    assert.ok(name in api, `missing export: ${name}`);
  }
  assert.equal(typeof api.generateImage, 'function');
  assert.ok(api.MODELS['nano-banana']);
});

// --- references / mimeFor (regression: error type changed Error → AiGenError) -

test('references are read from disk into inlineData parts, prompt text last', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-ref-'));
  const refPath = join(dir, 'parent-frame.png');
  const refBytes = Buffer.from('parent-frame-png-bytes');
  await writeFile(refPath, refBytes);

  let seen;
  const client = fakeClient(async (req) => {
    seen = req;
    return responseWith([imagePart]);
  });
  await generateImage({
    prompt: 'vary the lighting',
    references: [refPath],
    apiKey: 'k',
    _client: client,
  });

  const parts = seen.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].inlineData.mimeType, 'image/png');
  assert.equal(parts[0].inlineData.data, refBytes.toString('base64'));
  assert.deepEqual(parts.at(-1), { text: 'vary the lighting' });
});

test('unsupported reference extension throws AiGenError (regression: was bare Error)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-ref-'));
  const badRef = join(dir, 'ref.gif');
  await writeFile(badRef, Buffer.from('gif-bytes'));

  const client = fakeClient(async () => responseWith([imagePart]));
  await assert.rejects(
    generateImage({ prompt: 'x', references: [badRef], apiKey: 'k', _client: client }),
    (e) => {
      assert.ok(e instanceof AiGenError, 'must be on the taxonomy, not a bare Error');
      assert.equal(e.code, 'invalid-input');
      assert.match(e.message, /Unsupported image extension/);
      return true;
    }
  );
});

test('missing reference file rejects as invalid-input, not raw ENOENT', async () => {
  const client = fakeClient(async () => responseWith([imagePart]));
  await assert.rejects(
    generateImage({
      prompt: 'x',
      references: ['/nope/missing-parent-frame.png'],
      apiKey: 'k',
      _client: client,
    }),
    (e) => {
      assert.ok(e instanceof InvalidInputError, `escaped the taxonomy: ${e.name} ${e.code}`);
      assert.equal(e.cause?.code, 'ENOENT', 'original fs error preserved as cause');
      return true;
    }
  );
});

// --- CLI missing-key behavior (regression: was clean exit(1), now uncaught throw)

test('CLI script with missing key exits non-zero with the MissingKeyError message', () => {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // GEMINI_API_KEY='' (not deleted): dotenv never overrides an already-set var,
  // so a developer's package-local .env cannot leak a real key into this child
  // and turn an offline test into a billable API call. requireEnv treats '' as
  // missing, which is the path under test.
  const res = spawnSync(
    process.execPath,
    ['scripts/gen-image.js', 'prompts/_smoketest.flash.yaml'],
    {
      cwd: pkgRoot,
      env: { ...process.env, GEMINI_API_KEY: '' },
      encoding: 'utf8',
      timeout: 30_000,
    }
  );
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstderr: ${res.stderr}`);
  assert.match(res.stderr, /MissingKeyError/);
  assert.match(res.stderr, /Missing required env var: GEMINI_API_KEY/);
});

// --- remaining coverage gaps ------------------------------------------------

test('env-key fallback: GEMINI_API_KEY set, no per-call key → call proceeds', async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'env-key';
  try {
    const client = fakeClient(async () => responseWith([imagePart]));
    const result = await generateImage({ prompt: 'x', _client: client });
    assert.equal(result.images.length, 1);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('requireEnv returns the value when the var is set', () => {
  process.env.AI_GEN_TEST_SET = 'present';
  try {
    assert.equal(requireEnv('AI_GEN_TEST_SET'), 'present');
  } finally {
    delete process.env.AI_GEN_TEST_SET;
  }
});

test('optionalEnv: value, fallback on unset, fallback on empty string', () => {
  process.env.AI_GEN_TEST_OPT = 'val';
  try {
    assert.equal(optionalEnv('AI_GEN_TEST_OPT'), 'val');
  } finally {
    delete process.env.AI_GEN_TEST_OPT;
  }
  assert.equal(optionalEnv('AI_GEN_TEST_OPT', 'fb'), 'fb');
  process.env.AI_GEN_TEST_OPT = '';
  try {
    assert.equal(optionalEnv('AI_GEN_TEST_OPT', 'fb'), 'fb');
  } finally {
    delete process.env.AI_GEN_TEST_OPT;
  }
});

test('caller signal + timeout combine via AbortSignal.any; caller abort propagates', async () => {
  const controller = new AbortController();
  let seen;
  const client = fakeClient(async (req) => {
    seen = req;
    return responseWith([imagePart]);
  });
  await generateImage({ prompt: 'x', apiKey: 'k', signal: controller.signal, _client: client });

  const combined = seen.config.abortSignal;
  assert.ok(combined instanceof AbortSignal);
  assert.notEqual(combined, controller.signal, 'combined signal, not the caller signal itself');
  assert.equal(combined.aborted, false);
  controller.abort();
  assert.equal(combined.aborted, true, 'caller abort must propagate through the combined signal');
});

test('timeoutMs: 0 disables the bound — caller signal passes through, no httpOptions', async () => {
  const controller = new AbortController();
  let seen;
  const client = fakeClient(async (req) => {
    seen = req;
    return responseWith([imagePart]);
  });
  await generateImage({ prompt: 'x', apiKey: 'k', signal: controller.signal, timeoutMs: 0, _client: client });

  assert.equal(seen.config.abortSignal, controller.signal, 'single-signal path returns the signal itself');
  assert.equal(seen.config.httpOptions, undefined);
});

test('safety-block reason falls back: finishReason, then generic message', async () => {
  const finishReason = fakeClient(async () => ({
    candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }],
  }));
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: finishReason }),
    (e) => e instanceof SafetyBlockError && /IMAGE_SAFETY/.test(e.message)
  );

  const bare = fakeClient(async () => ({}));
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', _client: bare }),
    (e) => e instanceof SafetyBlockError && /no image data in response/.test(e.message)
  );
});

test('classifyError: message-only network match and API_KEY_INVALID literal', () => {
  // No status, no syscall code anywhere — only the message regex can decide.
  assert.equal(classifyError(new TypeError('fetch failed')).code, 'network');
  assert.equal(classifyError(new Error('socket hang up')).code, 'network');
  assert.equal(classifyError(new Error('[400] API_KEY_INVALID: check credentials')).code, 'missing-key');
});

test('saveImages writes one file per image, extension from mime, png fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-save-'));
  const images = [
    { mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes') },
    { data: Buffer.from('mystery-bytes') }, // no mimeType → png fallback
    { mimeType: 'image/svg+xml', data: Buffer.from('odd') }, // off-allowlist → png
  ];
  const paths = await saveImages(images, dir, 'tile');
  assert.deepEqual(
    paths.map((p) => p.split('/').pop()),
    ['tile-01.jpeg', 'tile-02.png', 'tile-03.png']
  );
  assert.deepEqual(await readFile(paths[0]), Buffer.from('jpeg-bytes'));
  assert.deepEqual(await readFile(paths[1]), Buffer.from('mystery-bytes'));
});

test('saveImages creates a missing outDir and rejects path-traversing prefixes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aigen-save-'));
  const nested = join(base, 'does', 'not', 'exist');
  const paths = await saveImages([{ mimeType: 'image/png', data: Buffer.from('x') }], nested);
  assert.deepEqual(await readFile(paths[0]), Buffer.from('x'));

  await assert.rejects(
    saveImages([{ mimeType: 'image/png', data: Buffer.from('x') }], base, '../escape'),
    (e) => e instanceof InvalidInputError
  );
});

// --- review-pass fixes: abort-reason recovery, validation, cost helper -------

// Mimics the real @google/genai behavior the offline fakes were masking: the
// SDK re-wraps the abort signal and rejects with a generic AbortError, never
// forwarding the reason. The library must recover the distinction itself.
const sdkFaithfulHangingClient = () =>
  fakeClient(
    (req) =>
      new Promise((_resolve, reject) => {
        const onAbort = () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (req.config.abortSignal.aborted) onAbort();
        else req.config.abortSignal.addEventListener('abort', onAbort, { once: true });
      })
  );

test('timeout expiry surfaces as TimeoutError even though the SDK drops abort reasons', async () => {
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', timeoutMs: 20, _client: sdkFaithfulHangingClient() }),
    (e) => {
      assert.equal(e.name, 'TimeoutError');
      assert.match(e.message, /timed out after 20ms/);
      assert.ok(!(e instanceof AiGenError), 'must pass through unwrapped');
      return true;
    }
  );
});

test('caller abort surfaces as AbortError through an SDK-faithful client', async () => {
  const controller = new AbortController();
  const pending = generateImage({
    prompt: 'x',
    apiKey: 'k',
    signal: controller.signal,
    _client: sdkFaithfulHangingClient(),
  });
  controller.abort();
  await assert.rejects(pending, (e) => {
    assert.equal(e.name, 'AbortError');
    assert.ok(!(e instanceof AiGenError), 'must pass through unwrapped');
    return true;
  });
});

test('timeoutMs: 0 with no caller signal sends no abort signal at all', async () => {
  let seen;
  const client = fakeClient(async (req) => {
    seen = req;
    return responseWith([imagePart]);
  });
  await generateImage({ prompt: 'x', apiKey: 'k', timeoutMs: 0, _client: client });
  assert.equal(seen.config.abortSignal, undefined);
  assert.equal(seen.config.httpOptions, undefined);
});

test('numberOfImages must be a positive integer — rejected before any I/O', async () => {
  let called = false;
  const client = fakeClient(async () => {
    called = true;
    return responseWith([imagePart]);
  });
  for (const bad of [0, -1, 2.5, '3']) {
    await assert.rejects(
      generateImage({ prompt: 'x', numberOfImages: bad, apiKey: 'k', _client: client }),
      (e) => e instanceof InvalidInputError && e.code === 'invalid-input'
    );
  }
  assert.equal(called, false, 'no request must be attempted');
});

test('explicit empty-string apiKey throws missing-key before any I/O (no env fallback)', async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'env-key-that-must-not-be-billed';
  let called = false;
  const client = fakeClient(async () => {
    called = true;
    return responseWith([imagePart]);
  });
  try {
    await assert.rejects(
      generateImage({ prompt: 'x', apiKey: '', _client: client }),
      (e) => e instanceof MissingKeyError && e.code === 'missing-key'
    );
    assert.equal(called, false);
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('provider may return fewer images than requested — success, cost reflects actual', async () => {
  const client = fakeClient(async () => responseWith([imagePart])); // asked 3, got 1
  const result = await generateImage({
    prompt: 'x',
    numberOfImages: 3,
    apiKey: 'k',
    _client: client,
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.costEstimate, estimateImageCost('nano-banana', 1));
});

test('classifyError tolerates non-Error throwables and foreign taxonomy instances', () => {
  assert.equal(classifyError('fetch failed').code, 'network'); // String(err) path
  assert.equal(classifyError(null).code, 'unknown');
  assert.equal(classifyError(undefined).code, 'unknown');

  // A taxonomy error built by a second module copy fails instanceof but must
  // be recognized structurally, never demoted to 'unknown'.
  const foreign = Object.assign(new Error('blocked by safety'), { code: 'safety-block' });
  assert.equal(classifyError(foreign), foreign);
});

test('estimateImageCost is the single source of truth for batch cost', () => {
  assert.equal(estimateImageCost('nano-banana', 3), 0.402); // the ~$0.40 fork estimate
  assert.equal(estimateImageCost('nano-banana', 1, '4K'), 0.24);
  assert.equal(estimateImageCost('does-not-exist', 5), 0); // unknown model → 0, not NaN
});

// --- adversarial-pass fixes ---------------------------------------------------

test('provider HTTP statuses route onto the taxonomy: 401/403 missing-key, 400 invalid-input', () => {
  assert.equal(classifyError(Object.assign(new Error('PERMISSION_DENIED'), { status: 403 })).code, 'missing-key');
  assert.equal(classifyError(Object.assign(new Error('unauthorized'), { status: 401 })).code, 'missing-key');
  assert.equal(classifyError(Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 })).code, 'invalid-input');
});

test('invalid timeoutMs and signal are rejected pre-I/O as invalid-input', async () => {
  const client = fakeClient(async () => responseWith([imagePart]));
  for (const badTimeout of [NaN, -5, Infinity]) {
    await assert.rejects(
      generateImage({ prompt: 'x', apiKey: 'k', timeoutMs: badTimeout, _client: client }),
      (e) => e instanceof InvalidInputError
    );
  }
  await assert.rejects(
    generateImage({ prompt: 'x', apiKey: 'k', signal: {}, _client: client }),
    (e) => e instanceof InvalidInputError && /AbortSignal/.test(e.message)
  );
});

test('input validation precedes key resolution: bad model on keyless host → invalid-input', async () => {
  await withoutGeminiKey(async () => {
    await assert.rejects(generateImage({ prompt: 'x', model: 'no-such-model' }), (e) => {
      assert.equal(e.code, 'invalid-input', 'must not report missing-key for a caller bug');
      return true;
    });
  });
});

test('video model alias is rejected by generateImage as invalid-input', async () => {
  await assert.rejects(
    generateImage({ prompt: 'x', model: 'veo', apiKey: 'k' }),
    (e) => e instanceof InvalidInputError && /video model/.test(e.message)
  );
});

test('a pre-aborted caller signal stops reference reads and surfaces as AbortError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-ref-'));
  const refPath = join(dir, 'frame.png');
  await writeFile(refPath, Buffer.from('png'));
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const client = fakeClient(async () => {
    called = true;
    return responseWith([imagePart]);
  });
  await assert.rejects(
    generateImage({
      prompt: 'x',
      references: [refPath],
      apiKey: 'k',
      signal: controller.signal,
      _client: client,
    }),
    (e) => {
      assert.equal(e.name, 'AbortError');
      assert.ok(!(e instanceof InvalidInputError), 'abort must not masquerade as a bad reference');
      return true;
    }
  );
  assert.equal(called, false, 'provider must never be called after a pre-abort');
});

test('extractImages tolerates null/undefined responses', () => {
  assert.deepEqual(extractImages(null), []);
  assert.deepEqual(extractImages(undefined), []);
});

test('saveImages fails loudly on a filename collision instead of overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-save-'));
  const images = [{ mimeType: 'image/png', data: Buffer.from('first') }];
  await saveImages(images, dir, 'tile');
  await assert.rejects(
    saveImages([{ mimeType: 'image/png', data: Buffer.from('second') }], dir, 'tile'),
    (e) => e.code === 'EEXIST'
  );
  // The original tile is untouched — last-writer-wins corruption is gone.
  assert.deepEqual(await readFile(join(dir, 'tile-01.png')), Buffer.from('first'));
});
