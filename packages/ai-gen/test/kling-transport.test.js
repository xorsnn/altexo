// Public transport contract: capture/replay real Response bodies without provider
// calls. Normal polling delays remain in force; no private _fetch/_pollMs hooks.
// protects=per-call HTTP coverage/isolation; fails_when=submit, poll or media bypasses
// the transport or a recording consumes the response; no_claim=live entitlement,
// model quality, vendor billing, or a deployed/sanitized application recorder.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVideo, createElement, saveVideo, InvalidInputError } from '../src/index.js';

const apiKey = 'transport-contract-test-secret';
const videoUrl = 'https://fixture.invalid/recorded.mp4';
const videoBytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 0, 255, 10, 128]);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function scriptedTransport(kind = 'video', taskId = 'video-task') {
  let polls = 0;
  const seen = [];
  const transport = async (input, init) => {
    const request = new Request(input, init);
    const body = request.method === 'GET' ? null : JSON.parse(await request.text());
    seen.push({ url: request.url, method: request.method, body,
      authorization: request.headers.get('authorization'), signal: init?.signal });
    if (request.url === videoUrl) return new Response(videoBytes);
    assert.match(request.url, /^https:\/\/api\.klingai\.com\/v1\//);
    assert.equal(request.headers.get('authorization'), `Bearer ${apiKey}`);
    if (request.method === 'POST') return json({ code: 0, data: { task_id: taskId } });
    assert.ok(request.url.endsWith('/' + taskId));
    polls++;
    if (kind === 'video' && polls === 1) {
      return json({ code: 0, data: { task_status: 'processing' } });
    }
    return json({ code: 0, data: { task_status: 'succeed', task_result: kind === 'element'
      ? { elements: [{ element_id: 'recorded-element' }] }
      : { videos: [{ url: videoUrl }] } } });
  };
  return { transport, seen };
}

// Test-only recorder: omit all request headers rather than persisting the bearer.
// Production code must additionally sanitize payloads, URLs and identifiers.
function recordingTransport(underlying, exchanges) {
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await underlying(input, init);
    exchanges.push({ url: request.url, method: request.method,
      body: request.method === 'GET' ? null : await request.clone().text(),
      status: response.status, responseHeaders: [...response.headers],
      bytes: Buffer.from(await response.clone().arrayBuffer()) });
    return response;
  };
}

function replayTransport(exchanges) {
  let next = 0;
  const transport = async (input, init) => {
    const request = new Request(input, init);
    const exchange = exchanges[next++];
    assert.ok(exchange, 'replay must not issue unrecorded requests');
    assert.equal(request.url, exchange.url);
    assert.equal(request.method, exchange.method);
    assert.equal(request.method === 'GET' ? null : await request.text(), exchange.body);
    return new Response(exchange.bytes, { status: exchange.status, headers: exchange.responseHeaders });
  };
  return { transport, assertComplete: () => assert.equal(next, exchanges.length) };
}

describe('public per-call Kling HTTP transport', { concurrency: true }, () => {
  test('records and replays image/Character video submit, every poll and exact media bytes', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-gen-transport-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const head = join(dir, 'head.png');
    const tail = join(dir, 'tail.png');
    await writeFile(head, Buffer.from('head-image-fixture'));
    await writeFile(tail, Buffer.from('tail-image-fixture'));
    const options = { prompt: 'A recorded character turns.', model: 'kling-pro', apiKey,
      imagePath: head, imageTailPath: tail, elementIds: ['recorded-element'],
      duration: 5, resolution: '1080p' };
    const source = scriptedTransport();
    const exchanges = [];
    const capture = recordingTransport(source.transport, exchanges);
    const result = await generateVideo({ ...options, fetch: capture });
    const capturedFile = await saveVideo(result.videoUrl, dir, 'capture', { fetch: capture });
    assert.deepEqual(await readFile(capturedFile), videoBytes);
    assert.equal(source.seen.length, 4);
    const submit = source.seen[0].body;
    assert.equal(submit.image, Buffer.from('head-image-fixture').toString('base64'));
    assert.equal(submit.image_tail, Buffer.from('tail-image-fixture').toString('base64'));
    assert.equal(submit.mode, 'pro');
    assert.deepEqual(submit.element_list, [{ element_id: 'recorded-element' }]);
    assert.equal(JSON.stringify(exchanges).includes(apiKey), false);
    const replay = replayTransport(exchanges);
    const repeated = await generateVideo({ ...options, fetch: replay.transport });
    const replayedFile = await saveVideo(repeated.videoUrl, dir, 'replay', { fetch: replay.transport });
    assert.deepEqual(repeated, result);
    assert.deepEqual(await readFile(replayedFile), videoBytes);
    replay.assertComplete();
  });

  test('records and replays Character creation through the same public option', async () => {
    const options = { name: 'capture', description: 'offline subject', apiKey,
      imageUrls: ['front-base64-fixture', 'side-base64-fixture'] };
    const source = scriptedTransport('element', 'element-task');
    const exchanges = [];
    const result = await createElement({ ...options,
      fetch: recordingTransport(source.transport, exchanges) });
    assert.equal(result.elementId, 'recorded-element');
    assert.equal(source.seen.length, 2);
    assert.equal(source.seen[0].body.element_image_list.frontal_image, options.imageUrls[0]);
    assert.deepEqual(source.seen[0].body.element_image_list.refer_images,
      [{ image_url: options.imageUrls[1] }]);
    const replay = replayTransport(exchanges);
    assert.deepEqual(await createElement({ ...options, fetch: replay.transport }), result);
    replay.assertComplete();
  });

  test('concurrent calls keep their submit/poll transports and task identities separate', async () => {
    const a = scriptedTransport('element', 'task-a');
    const b = scriptedTransport('element', 'task-b');
    const options = { apiKey, imageUrls: ['front', 'side'] };
    const [first, second] = await Promise.all([
      createElement({ ...options, fetch: a.transport }),
      createElement({ ...options, fetch: b.transport }),
    ]);
    assert.equal(first.taskId, 'task-a');
    assert.equal(second.taskId, 'task-b');
    assert.equal(a.seen.length, 2);
    assert.equal(b.seen.length, 2);
  });

  test('invalid public transports fail before missing credentials, frame reads or downloads', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-gen-invalid-transport-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    for (const invalid of [null, false, 'fetch', {}, 42]) {
      const isInvalidTransport = (error) => error instanceof InvalidInputError && /fetch must/.test(error.message);
      await assert.rejects(generateVideo({ prompt: 'test', apiKey: '',
        imagePath: join(dir, 'missing.png'), fetch: invalid }), isInvalidTransport);
      await assert.rejects(createElement({ apiKey: '', imagePaths: [join(dir, 'missing.png'), 'missing'],
        fetch: invalid }), isInvalidTransport);
      await assert.rejects(saveVideo(videoUrl, dir, 'bad', { fetch: invalid }), isInvalidTransport);
    }
    assert.deepEqual(await readdir(dir), []);
  });

  test('transport provider failures preserve insufficient-balance classification', async () => {
    const fetch = async () => json({ code: 1102, message: 'Account balance not enough' }, 429);
    await assert.rejects(generateVideo({ prompt: 'test', apiKey, fetch }),
      (error) => error.code === 'insufficient-balance');
    await assert.rejects(createElement({ imageUrls: ['front', 'side'], apiKey, fetch }),
      (error) => error.code === 'insufficient-balance');
  });

  test('public transport receives cancellation signal and abort retains the caller reason', async () => {
    const controller = new AbortController();
    const reason = new DOMException('owner cancelled', 'AbortError');
    let observedSignal;
    const fetch = async (_url, init) => {
      observedSignal = init.signal;
      controller.abort(reason);
      throw new DOMException('fetch aborted', 'AbortError');
    };
    await assert.rejects(generateVideo({ prompt: 'test', apiKey, signal: controller.signal, fetch }),
      (error) => error === reason);
    assert.equal(observedSignal.aborted, true);
  });

  test('download errors and transport failures remain observable without writing a video', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-gen-download-failure-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await assert.rejects(saveVideo(videoUrl, dir, 'bad', {
      fetch: async () => new Response('unavailable', { status: 503, statusText: 'Unavailable' }),
    }), /Download failed \(503 Unavailable\)/);
    const failure = new Error('transport stopped');
    await assert.rejects(saveVideo(videoUrl, dir, 'bad', {
      fetch: async () => { throw failure; },
    }), (error) => error === failure);
    assert.deepEqual(await readdir(dir), []);
  });
});
