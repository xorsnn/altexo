// Offline tests for the Kling video library contract: no network, no API keys.
// Run with `npm test` (node --test).
//
// generateVideo is hardened to the same contract as generateImage (0.5.0):
//   - All input is validated BEFORE keys are resolved and before any I/O, so a
//     bad call reports 'invalid-input', not the host's key situation.
//   - A per-call apiKey falls back to KLING_API_KEY; an explicit empty/non-string
//     value throws MissingKeyError before I/O.
//   - Returns the stable shape { videoUrl, taskId, modelId, costEstimate,
//     durationSeconds, aspect } — never the raw provider payload.
//   - Provider failures map onto the taxonomy (rate-limit / missing-key /
//     invalid-input / network); caller aborts and timeouts pass through unwrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateVideo, saveVideo, submitAndPoll, validateKlingApiKey } from '../src/kling.js';
import { MODELS, estimateVideoCost } from '../src/models.js';
import {
  AiGenError,
  MissingKeyError,
  RateLimitError,
  InsufficientBalanceError,
  NetworkError,
  InvalidInputError,
} from '../src/errors.js';

// --- fixtures -------------------------------------------------------------

// A fake `fetch` that honors an aborted signal (like the real one) and answers
// submit (POST) and poll (GET) from a per-call script. `poll` defaults to a
// single succeeded poll carrying one video.
function fakeFetch({
  submit = { ok: true, status: 200, body: { code: 0, data: { task_id: 'task-123' } } },
  polls = [{ ok: true, status: 200, body: { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.kling/test.mp4' }] } } } }],
} = {}) {
  let pollIdx = 0;
  const calls = [];
  const impl = async (url, opts = {}) => {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
    const method = opts.method ?? 'GET';
    calls.push({ url, method, body: opts.body });
    const r = method === 'POST' ? submit : polls[Math.min(pollIdx++, polls.length - 1)];
    return { ok: r.ok ?? r.status < 400, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  };
  impl.calls = calls;
  return impl;
}

const KEYS = { apiKey: 'api-key-kling-test' };
// Default `_fetch` to a fresh fake so a test can never accidentally hit the real
// Kling API; an explicit `_fetch` override (to inspect calls) still wins.
const base = (over = {}) => ({ prompt: 'a lighthouse pans left', model: 'kling-pro', _pollMs: 1, _fetch: fakeFetch(), ...KEYS, ...over });

// Run a block with the Kling env keys guaranteed absent, restoring them after.
async function withoutKlingKeys(fn) {
  const saved = process.env.KLING_API_KEY;
  delete process.env.KLING_API_KEY;
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.KLING_API_KEY = saved;
  }
}

// --- input validation: before keys, before any I/O ------------------------

test('unknown model alias throws invalid-input (before any key/I/O)', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ model: 'no-such-model', _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /Unknown model alias/.test(e.message),
    );
  });
});

test('an image model alias is rejected by generateVideo (kind check)', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ model: 'nano-banana', _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /not a Kling video model/.test(e.message),
    );
  });
});

test('a Veo (non-kling) video alias is rejected', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ model: 'veo', _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /not a Kling video model/.test(e.message),
    );
  });
});

test('tail frame without a head frame is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ imageTailPath: '/tmp/tail.png', _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /image_tail.*requires imagePath/.test(e.message),
    );
  });
});

test('more than 3 elements is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ elementIds: ['a', 'b', 'c', 'd'], _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /at most 3 elements/.test(e.message),
    );
  });
});

test('a duration outside the model range is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    // kling-pro is 3-15s; 2 is out of range.
    await assert.rejects(
      generateVideo(base({ duration: 2, _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /supports.*durations/.test(e.message),
    );
  });
});

test('a malformed multiShot is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ multiShot: [], _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /multiShot must be a non-empty array/.test(e.message),
    );
  });
});

test('a non-AbortSignal signal is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ signal: {}, _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /signal must be an AbortSignal/.test(e.message),
    );
  });
});

test('a negative timeoutMs is invalid-input', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ timeoutMs: -1, _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /timeoutMs must be a non-negative/.test(e.message),
    );
  });
});

// --- keys -----------------------------------------------------------------

test('no keys anywhere rejects missing-key (input was valid)', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo({ prompt: 'x', model: 'kling-pro', _fetch: fakeFetch(), _pollMs: 1 }),
      (e) => e instanceof MissingKeyError && e.code === 'missing-key',
    );
  });
});

test('an explicit empty apiKey throws missing-key before I/O', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    await assert.rejects(
      generateVideo(base({ apiKey: '   ', _fetch: f })),
      (e) => e instanceof MissingKeyError && /apiKey.*empty/.test(e.message),
    );
    assert.equal(f.calls.length, 0, 'no network call before the key check');
  });
});

test('per-call keys skip the env entirely', async () => {
  await withoutKlingKeys(async () => {
    const result = await generateVideo(base());
    assert.equal(result.videoUrl, 'https://cdn.kling/test.mp4');
  });
});

// --- happy path + stable return shape -------------------------------------

test('returns { videoUrl, taskId, modelId, costEstimate, durationSeconds, aspect } — no raw leak', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    const result = await generateVideo(base({ duration: 5, aspect: '16:9', _fetch: f }));
    assert.deepEqual(result, {
      videoUrl: 'https://cdn.kling/test.mp4',
      taskId: 'task-123',
      modelId: MODELS['kling-pro'].id,
      costEstimate: estimateVideoCost('kling-pro', 5),
      durationSeconds: 5,
      aspect: '16:9',
    });
    assert.equal('raw' in result, false, 'raw provider payload must not leak');
    // Submit hits image-less text2video; one POST + one GET poll.
    assert.equal(f.calls[0].method, 'POST');
    assert.ok(f.calls[0].url.endsWith('/v1/videos/text2video'));
    assert.ok(f.calls[1].url.includes('/v1/videos/text2video/task-123'));
  });
});

test('a head frame routes to image2video and base64-encodes the file', async () => {
  await withoutKlingKeys(async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'kling-'));
    const head = join(dir, 'head.png');
    await writeFile(head, Buffer.from('fake-png'));
    const f = fakeFetch();
    await generateVideo(base({ imagePath: head, _fetch: f }));
    assert.ok(f.calls[0].url.endsWith('/v1/videos/image2video'));
    const payload = JSON.parse(f.calls[0].body);
    assert.equal(payload.image, Buffer.from('fake-png').toString('base64'));
  });
});

test('an unreadable head frame is invalid-input, not raw ENOENT', async () => {
  await withoutKlingKeys(async () => {
    await assert.rejects(
      generateVideo(base({ imagePath: '/no/such/frame.png', _fetch: fakeFetch() })),
      (e) => e instanceof InvalidInputError && /Could not read frame image/.test(e.message),
    );
  });
});

test('audio costEstimate applies the model audioMultiplier', async () => {
  await withoutKlingKeys(async () => {
    const withAudio = await generateVideo(base({ audio: true, duration: 5, _fetch: fakeFetch() }));
    const silent = await generateVideo(base({ audio: false, duration: 5, _fetch: fakeFetch() }));
    assert.equal(withAudio.costEstimate, estimateVideoCost('kling-pro', 5, { audio: true }));
    assert.equal(withAudio.costEstimate, silent.costEstimate * MODELS['kling-pro'].audioMultiplier);
  });
});

// --- provider failures map onto the taxonomy ------------------------------

test('provider 429 → RateLimitError (code rate-limit)', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ submit: { ok: false, status: 429, body: { code: 1, message: 'slow down' } } });
    await assert.rejects(generateVideo(base({ _fetch: f })), (e) => e instanceof RateLimitError && e.code === 'rate-limit');
  });
});

// The end-to-end version of 0.10.0's split, driven through the real `api()`
// rather than classifyError alone. This is the path that actually broke: `api()`
// read `json.code` to decide whether to throw and then DROPPED it, so an account
// with no money and a momentary throttle reached the embedder identically — and
// rompix retried the dead-broke one forever while paging an operator who could
// not fund it. The assertion is that the business code now survives the throw.
test('a Kling 429 with business code 1102 → InsufficientBalanceError, not RateLimitError', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({
      submit: {
        ok: false,
        status: 429,
        body: { code: 1102, message: 'Account balance not enough' },
      },
    });
    await assert.rejects(
      generateVideo(base({ _fetch: f })),
      (e) =>
        e instanceof InsufficientBalanceError &&
        e.code === 'insufficient-balance' &&
        // The provider's own words survive for the operator; the embedder decides
        // what a user sees.
        /Account balance not enough/.test(e.message)
    );
  });
});

test('provider 401 → MissingKeyError (rejected key)', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ submit: { ok: false, status: 401, body: { code: 1, message: 'bad token' } } });
    await assert.rejects(generateVideo(base({ _fetch: f })), (e) => e instanceof MissingKeyError);
  });
});

test('provider 400 → InvalidInputError', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ submit: { ok: false, status: 400, body: { code: 1, message: 'invalid model_name' } } });
    await assert.rejects(generateVideo(base({ _fetch: f })), (e) => e instanceof InvalidInputError);
  });
});

test('provider 5xx → NetworkError', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ submit: { ok: false, status: 503, body: { code: 1, message: 'upstream down' } } });
    await assert.rejects(generateVideo(base({ _fetch: f })), (e) => e instanceof NetworkError);
  });
});

test('a failed Kling task surfaces as an AiGenError (not a raw throw)', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch({ polls: [{ ok: true, status: 200, body: { code: 0, data: { task_status: 'failed', task_status_msg: 'content rejected' } } }] });
    await assert.rejects(
      generateVideo(base({ _fetch: f })),
      (e) => e instanceof AiGenError && /content rejected/.test(e.message),
    );
  });
});

// --- abort + timeout pass through unwrapped -------------------------------

test('caller abort passes through unwrapped (err.name === AbortError)', async () => {
  await withoutKlingKeys(async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      generateVideo(base({ signal: controller.signal, _fetch: fakeFetch() })),
      (e) => e.name === 'AbortError' && !(e instanceof AiGenError),
    );
  });
});

test('timeout expiry surfaces as TimeoutError, not wrapped', async () => {
  await withoutKlingKeys(async () => {
    // Poll never reaches 'succeed', so the 20ms timeout fires during the wait.
    const f = fakeFetch({ polls: [{ ok: true, status: 200, body: { code: 0, data: { task_status: 'processing' } } }] });
    await assert.rejects(
      generateVideo(base({ timeoutMs: 20, _pollMs: 5_000, _fetch: f })),
      (e) => e.name === 'TimeoutError' && !(e instanceof AiGenError),
    );
  });
});

// --- exports map ----------------------------------------------------------

test('package root (exports map) exposes generateVideo, saveVideo, estimateVideoCost', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod.generateVideo, 'function');
  assert.equal(typeof mod.saveVideo, 'function');
  assert.equal(typeof mod.estimateVideoCost, 'function');
  assert.equal(typeof mod.validateKlingApiKey, 'function');
});

// --- the deep submitAndPoll helper still works for non-video flows ---------

test('submitAndPoll still polls to success for the deep callers (elements)', async () => {
  const f = fakeFetch({ polls: [{ ok: true, status: 200, body: { code: 0, data: { task_status: 'succeed', task_result: { elements: [{ element_id: 'el-9' }] } } } }] });
  const { data } = await submitAndPoll('/v1/elements', { x: 1 }, { keys: KEYS, fetchImpl: f, log: false, pollMs: 1 });
  assert.equal(data.task_result.elements[0].element_id, 'el-9');
});

void saveVideo; // exercised by the CLI; included here to assert the export exists


// --- validateKlingApiKey ---------------------------------------------------
//
// The credential probe. Three verdicts, and the split between 'invalid' and
// 'unavailable' is the whole point: callers demote a stored key on 'invalid', so
// anything short of the provider actually refusing the credential must come back
// 'unavailable' or an outage costs users a key they have to go re-paste.

// A one-shot fake for the probe: answers the single GET with the given status.
function probeFetch(res) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
    calls.push({ url, method: opts.method ?? 'GET', headers: opts.headers, redirect: opts.redirect });
    if (res instanceof Error) throw res;
    return { ok: (res.status ?? 200) < 400, status: res.status ?? 200 };
  };
  impl.calls = calls;
  return impl;
}

test('validateKlingApiKey: a 200 from the provider is valid', async () => {
  const r = await validateKlingApiKey({ ...KEYS, _fetch: probeFetch({ status: 200 }) });
  assert.deepEqual(r, { status: 'valid' });
});

test('validateKlingApiKey: 401 and 403 are invalid (the provider refused it)', async () => {
  for (const status of [401, 403]) {
    const r = await validateKlingApiKey({ ...KEYS, _fetch: probeFetch({ status }) });
    assert.equal(r.status, 'invalid', `expected ${status} to be invalid`);
    assert.match(r.message, new RegExp(String(status)));
  }
});

test('validateKlingApiKey: 429 and 5xx are unavailable, NOT invalid', async () => {
  // Regression guard: demoting a stored key on a provider blip is the expensive
  // mistake this split exists to prevent.
  for (const status of [429, 500, 502, 503]) {
    const r = await validateKlingApiKey({ ...KEYS, _fetch: probeFetch({ status }) });
    assert.equal(r.status, 'unavailable', `expected ${status} to be unavailable`);
  }
});

test('validateKlingApiKey: a transport failure is unavailable, not invalid', async () => {
  const r = await validateKlingApiKey({ ...KEYS, _fetch: probeFetch(new Error('ECONNREFUSED')) });
  assert.equal(r.status, 'unavailable');
});

test('validateKlingApiKey: an empty or non-string key is invalid with NO network call', async () => {
  const f = probeFetch({ status: 200 });
  for (const bad of ['', '   ', undefined, null, 42, {}]) {
    const r = await validateKlingApiKey({ apiKey: bad, _fetch: f });
    assert.equal(r.status, 'invalid');
  }
  assert.equal(f.calls.length, 0, 'must not probe on a structurally bad key');
});

test('validateKlingApiKey: NEVER throws, whatever the fetch does', async () => {
  // Total by contract — callers consume the verdict without a try/catch.
  for (const thrown of [new Error('x'), new TypeError('y'), 'a string', null]) {
    const r = await validateKlingApiKey({ ...KEYS, _fetch: async () => { throw thrown; } });
    assert.equal(r.status, 'unavailable');
  }
});

test('validateKlingApiKey: an aborted signal lands as unavailable, not a throw', async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await validateKlingApiKey({ ...KEYS, signal: ac.signal, _fetch: probeFetch({ status: 200 }) });
  assert.equal(r.status, 'unavailable');
});

test('validateKlingApiKey: timeoutMs expiry lands as unavailable', async () => {
  const hang = async (url, opts = {}) =>
    new Promise((_res, rej) => {
      opts.signal?.addEventListener('abort', () => rej(opts.signal.reason), { once: true });
    });
  const r = await validateKlingApiKey({ ...KEYS, timeoutMs: 20, _fetch: hang });
  assert.equal(r.status, 'unavailable');
});

test('validateKlingApiKey: probes a bearer-authed, non-mutating GET and refuses redirects', async () => {
  const f = probeFetch({ status: 200 });
  await validateKlingApiKey({ ...KEYS, _fetch: f });
  assert.equal(f.calls.length, 1);
  const [call] = f.calls;
  assert.equal(call.method, 'GET', 'the probe must never mutate');
  assert.equal(call.redirect, 'error', 'a redirect could leak the Authorization header');
  // The API key IS the token now — sent verbatim, no signing step, nothing to expire.
  assert.equal(call.headers.Authorization, `Bearer ${KEYS.apiKey}`);
  assert.doesNotMatch(call.url, /api-key-kling-test/, 'the key must never ride in the URL');
});

test('validateKlingApiKey: takes NO env fallback (unlike generateVideo)', async () => {
  // Validating "whatever is in the environment" is not a question anyone means to ask.
  process.env.KLING_API_KEY = 'env-api-key';
  try {
    const f = probeFetch({ status: 200 });
    const r = await validateKlingApiKey({ _fetch: f });
    assert.equal(r.status, 'invalid');
    assert.equal(f.calls.length, 0);
  } finally {
    delete process.env.KLING_API_KEY;
  }
});
