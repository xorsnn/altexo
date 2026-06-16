// Offline tests for the Kling video library contract: no network, no API keys.
// Run with `npm test` (node --test).
//
// generateVideo is hardened to the same contract as generateImage (0.5.0):
//   - All input is validated BEFORE keys are resolved and before any I/O, so a
//     bad call reports 'invalid-input', not the host's key situation.
//   - Per-call accessKey/secretKey fall back to KLING_ACCESS_KEY/KLING_SECRET_KEY;
//     an explicit empty/non-string value throws MissingKeyError before I/O.
//   - Returns the stable shape { videoUrl, taskId, modelId, costEstimate,
//     durationSeconds, aspect } — never the raw provider payload.
//   - Provider failures map onto the taxonomy (rate-limit / missing-key /
//     invalid-input / network); caller aborts and timeouts pass through unwrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateVideo, saveVideo, submitAndPoll } from '../src/kling.js';
import { MODELS, estimateVideoCost } from '../src/models.js';
import {
  AiGenError,
  MissingKeyError,
  RateLimitError,
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

const KEYS = { accessKey: 'ak-test', secretKey: 'sk-test' };
// Default `_fetch` to a fresh fake so a test can never accidentally hit the real
// Kling API; an explicit `_fetch` override (to inspect calls) still wins.
const base = (over = {}) => ({ prompt: 'a lighthouse pans left', model: 'kling-pro', _pollMs: 1, _fetch: fakeFetch(), ...KEYS, ...over });

// Run a block with the Kling env keys guaranteed absent, restoring them after.
async function withoutKlingKeys(fn) {
  const saved = { a: process.env.KLING_ACCESS_KEY, s: process.env.KLING_SECRET_KEY };
  delete process.env.KLING_ACCESS_KEY;
  delete process.env.KLING_SECRET_KEY;
  try {
    return await fn();
  } finally {
    if (saved.a !== undefined) process.env.KLING_ACCESS_KEY = saved.a;
    if (saved.s !== undefined) process.env.KLING_SECRET_KEY = saved.s;
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

test('an explicit empty accessKey throws missing-key before I/O', async () => {
  await withoutKlingKeys(async () => {
    const f = fakeFetch();
    await assert.rejects(
      generateVideo(base({ accessKey: '   ', _fetch: f })),
      (e) => e instanceof MissingKeyError && /accessKey.*empty/.test(e.message),
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
});

// --- the deep submitAndPoll helper still works for non-video flows ---------

test('submitAndPoll still polls to success for the deep callers (elements)', async () => {
  const f = fakeFetch({ polls: [{ ok: true, status: 200, body: { code: 0, data: { task_status: 'succeed', task_result: { elements: [{ element_id: 'el-9' }] } } } }] });
  const { data } = await submitAndPoll('/v1/elements', { x: 1 }, { keys: KEYS, fetchImpl: f, log: false, pollMs: 1 });
  assert.equal(data.task_result.elements[0].element_id, 'el-9');
});

void saveVideo; // exercised by the CLI; included here to assert the export exists
