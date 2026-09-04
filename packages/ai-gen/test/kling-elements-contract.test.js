// Offline tests for the Kling ELEMENT library contract: no network, no API keys.
// Run with `npm test` (node --test).
//
// createElement joined the public surface in 0.11.0 and is held to the same contract as
// generateVideo:
//   - All input is validated BEFORE keys are resolved and before any I/O, so an over-long
//     reference list is refused without paying for a single disk read, and a bad call reports
//     'invalid-input' rather than the host's key situation.
//   - A per-call apiKey falls back to KLING_API_KEY. This is the reason the function was
//     promoted: an element exists only inside the account that built it, so a caller working
//     across two credentials must be able to choose.
//   - Returns the stable shape { elementId, taskId, raw }.
//   - Provider failures map onto the taxonomy; caller aborts pass through unwrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createElement } from '../src/kling-elements.js';
import { MissingKeyError, InvalidInputError, RateLimitError } from '../src/errors.js';

// --- fixtures -------------------------------------------------------------

// A fake `fetch` that answers submit (POST) then poll (GET) and records headers, which the
// stock kling-contract fake does not — the per-call key test needs to see Authorization.
function fakeFetch({
  submit = { ok: true, status: 200, body: { code: 0, data: { task_id: 'el-task-1' } } },
  polls = [{
    ok: true, status: 200,
    body: { code: 0, data: { task_status: 'succeed', task_result: { elements: [{ element_id: 'el-42' }] } } },
  }],
} = {}) {
  let pollIdx = 0;
  const calls = [];
  const impl = async (url, opts = {}) => {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
    const method = opts.method ?? 'GET';
    calls.push({ url, method, body: opts.body, headers: opts.headers });
    const r = method === 'POST' ? submit : polls[Math.min(pollIdx++, polls.length - 1)];
    return { ok: r.ok ?? r.status < 400, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  };
  impl.calls = calls;
  return impl;
}

const KEYS = { apiKey: 'api-key-kling-test' };
// Default `_fetch` to a fresh fake so a test can never accidentally hit the real Kling API.
const base = (over = {}) => ({
  name: 'Leslie', imagePaths: [], imageUrls: ['aaa', 'bbb'],
  _pollMs: 1, _fetch: fakeFetch(), ...KEYS, ...over,
});

async function withoutKlingKeys(fn) {
  const saved = process.env.KLING_API_KEY;
  delete process.env.KLING_API_KEY;
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.KLING_API_KEY = saved;
  }
}

async function twoImages() {
  const dir = await mkdtemp(join(tmpdir(), 'aigen-el-'));
  const hero = join(dir, 'hero.png');
  const portrait = join(dir, 'portrait.png');
  await writeFile(hero, Buffer.from('hero-bytes'));
  await writeFile(portrait, Buffer.from('portrait-bytes'));
  return { dir, hero, portrait };
}

// --- input validation: before keys, before any I/O ------------------------

test('unknown model alias throws invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ model: 'no-such-model' })), InvalidInputError);
  });
});

test('an image model alias is rejected (kind check)', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ model: 'nano-banana' })), InvalidInputError);
  });
});

test('a bad type is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ type: 'audio' })), /type must be/);
  });
});

test('no reference sources at all is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ imageUrls: [] })), /at least one imagePath or imageUrl/);
  });
});

test('an image element with a single source is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ imageUrls: ['only-one'] })), /≥2 images total/);
  });
});

// THE regression this hardening exists for: the old implementation read every path off disk
// and only then counted them, so an over-long list paid for the reads before being refused —
// and a caller with no key learned about the key rather than about their call.
test('an over-long reference list is refused WITHOUT reading a single file', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      createElement(base({
        imageUrls: [],
        imagePaths: ['/nope/1.png', '/nope/2.png', '/nope/3.png', '/nope/4.png', '/nope/5.png'],
      })),
      // The count message, NOT an ENOENT and NOT a missing-key complaint.
      /at most 4 images per element/,
    );
  });
});

test('a non-AbortSignal signal is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ signal: {} })), InvalidInputError);
  });
});

test('a negative timeoutMs is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(createElement(base({ timeoutMs: -1 })), InvalidInputError);
  });
});

// --- keys ------------------------------------------------------------------

test('no keys anywhere rejects missing-key (input was valid)', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      createElement({ name: 'x', imageUrls: ['a', 'b'], _fetch: fakeFetch(), _pollMs: 1 }),
      MissingKeyError,
    );
  });
});

test('an explicit empty apiKey throws missing-key before any request', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    await assert.rejects(createElement(base({ apiKey: '   ', _fetch: f })), MissingKeyError);
    assert.equal(f.calls.length, 0);
  });
});

// The whole reason createElement was promoted to the public surface: an element is scoped to
// the account that built it, so a caller spanning two credentials must be able to choose one.
test('a per-call apiKey is what reaches the provider, with no env fallback', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    const r = await createElement(base({ apiKey: 'byo-key-123', _fetch: f }));
    assert.equal(r.elementId, 'el-42');
    assert.equal(f.calls[0].headers.Authorization, 'Bearer byo-key-123');
  });
});

// --- shape and payload -----------------------------------------------------

test('returns { elementId, taskId, raw }', async () => {
  await withoutKlingKeys(async () => {
    const r = await createElement(base());
    assert.equal(r.elementId, 'el-42');
    assert.equal(r.taskId, 'el-task-1');
    assert.ok(r.raw);
  });
});

test('reads images from disk into frontal_image + refer_images, in order', async () => {
  const { hero, portrait } = await twoImages();
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    await createElement(base({ imageUrls: [], imagePaths: [hero, portrait], _fetch: f }));
    const body = JSON.parse(f.calls[0].body);
    assert.equal(body.reference_type, 'image_refer');
    assert.equal(body.element_image_list.frontal_image, Buffer.from('hero-bytes').toString('base64'));
    assert.deepEqual(
      body.element_image_list.refer_images,
      [{ image_url: Buffer.from('portrait-bytes').toString('base64') }],
    );
  });
});

test('element_name is truncated to 20 chars and description to 100', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    await createElement(base({ name: 'x'.repeat(40), description: 'y'.repeat(200), _fetch: f }));
    const body = JSON.parse(f.calls[0].body);
    assert.equal(body.element_name.length, 20);
    assert.equal(body.element_description.length, 100);
  });
});

test('an unreadable reference image is invalid-input, not a raw ENOENT', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      createElement(base({ imageUrls: ['ok-source'], imagePaths: ['/definitely/missing.png'] })),
      (err) => err instanceof InvalidInputError && /could not read reference image/.test(err.message),
    );
  });
});

// --- taxonomy and cancellation --------------------------------------------

test('a provider 429 maps onto the taxonomy', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ submit: { ok: false, status: 429, body: { code: 1103, message: 'too fast' } } });
    await assert.rejects(createElement(base({ _fetch: f })), RateLimitError);
  });
});

test('a caller abort passes through unwrapped', async () => {
  await withoutKlingKeys(async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(
      createElement(base({ signal: ctrl.signal })),
      (err) => err.name === 'AbortError',
    );
  });
});

test('library calls are quiet by default (log defaults to false)', async () => {
  await withoutKlingKeys(async () => {
    const seen = [];
    const orig = console.log;
    console.log = (...a) => seen.push(a.join(' '));
    try {
      await createElement(base());
    } finally {
      console.log = orig;
    }
    assert.equal(seen.filter((l) => l.includes('kling-element')).length, 0);
  });
});
