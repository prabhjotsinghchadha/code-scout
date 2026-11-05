import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbortError, fetchInRanges, Limiter, LinkExpiredError, shortDuration } from './range-fetch.ts';

/** A fake server holding `file`, answering Range requests like a CDN would. */
function fakeServer(file: Uint8Array, opts: { ignoreRange?: boolean; failFirst?: number; status?: number } = {}) {
  const calls: string[] = [];
  let failures = opts.failFirst ?? 0;
  let active = 0;
  let maxActive = 0;
  const fetch = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range') ?? '';
    calls.push(range);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    if (opts.status) return new Response('no', { status: opts.status });
    if (failures > 0) {
      failures--;
      return new Response('busy', { status: 503 });
    }
    if (opts.ignoreRange || !range) return new Response(file, { status: 200 });
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number);
    if (from >= file.length) return new Response(null, { status: 416 });
    return new Response(file.slice(from, Math.min(to + 1, file.length)), { status: 206 });
  }) as typeof fetch;
  return { fetch, calls, maxActive: () => maxActive };
}

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

test('downloads a file as parallel ranges and joins them in order', async () => {
  const file = bytes(1000);
  const server = fakeServer(file);
  let seen = 0;
  const out = await fetchInRanges('https://cdn.example.com/a.ts', {
    limiter: new Limiter(6),
    chunkSize: 128,
    parallel: 4,
    fetch: server.fetch,
    onBytes: (n) => (seen += n),
  });
  assert.deepEqual(out, file);
  assert.equal(seen, 1000);
  assert.ok(server.maxActive() > 1, 'ranges run side by side');
  assert.ok(server.maxActive() <= 4);
});

test('handles files that end exactly on a range boundary (416 marks the end)', async () => {
  const file = bytes(512);
  const server = fakeServer(file);
  const out = await fetchInRanges('https://cdn.example.com/b.ts', {
    limiter: new Limiter(2),
    chunkSize: 128,
    fetch: server.fetch,
  });
  assert.deepEqual(out, file);
});

test('uses the whole body when the server ignores Range, then stops splitting that host', async () => {
  const file = bytes(300);
  const server = fakeServer(file, { ignoreRange: true });
  const out = await fetchInRanges('https://norange.example.com/c.ts', {
    limiter: new Limiter(6),
    chunkSize: 128,
    fetch: server.fetch,
  });
  assert.deepEqual(out, file);
  const again = fakeServer(file, { ignoreRange: true });
  await fetchInRanges('https://norange.example.com/d.ts', { limiter: new Limiter(6), chunkSize: 128, fetch: again.fetch });
  assert.equal(again.calls.length, 1, 'one request once the host is known not to support ranges');
});

test('retries busy responses and reports expired links', async () => {
  const file = bytes(200);
  const flaky = fakeServer(file, { failFirst: 2 });
  const out = await fetchInRanges('https://cdn.example.com/e.ts', {
    limiter: new Limiter(1),
    chunkSize: 128,
    fetch: flaky.fetch,
    retryDelayMs: 1,
  });
  assert.deepEqual(out, file);

  const expired = fakeServer(file, { status: 403 });
  await assert.rejects(
    fetchInRanges('https://cdn.example.com/f.ts', { limiter: new Limiter(2), fetch: expired.fetch }),
    LinkExpiredError,
  );
  const missing = fakeServer(file, { status: 404 });
  await assert.rejects(
    fetchInRanges('https://cdn.example.com/g.ts', { limiter: new Limiter(2), fetch: missing.fetch, retryDelayMs: 1 }),
    /HTTP 404/,
  );
});

test('stops when aborted', async () => {
  const controller = new AbortController();
  const server = fakeServer(bytes(5000));
  const p = fetchInRanges('https://cdn.example.com/h.ts', {
    limiter: new Limiter(1),
    chunkSize: 100,
    fetch: server.fetch,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(p, AbortError);
});

test('limiter runs the lowest priority first and never more than max at once', async () => {
  const limiter = new Limiter(1);
  const order: number[] = [];
  const task = (n: number) => () => new Promise<void>((r) => setTimeout(() => (order.push(n), r()), 1));
  await Promise.all([limiter.run(task(0), 0), limiter.run(task(9), 9), limiter.run(task(3), 3), limiter.run(task(1), 1)]);
  assert.deepEqual(order, [0, 1, 3, 9]);
});

test('limiter can be raised and lowered while running', async () => {
  const limiter = new Limiter(1);
  const releases: (() => void)[] = [];
  const task = () => new Promise<void>((r) => releases.push(r));
  const all = Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));
  assert.equal(limiter.active, 1);
  limiter.setMax(4);
  assert.equal(limiter.active, 4, 'more start straight away');
  limiter.setMax(2);
  assert.equal(limiter.active, 4, 'running ones finish');
  releases.splice(0, 4).forEach((r) => r());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(limiter.active, 2, 'then no more than the new max');
  releases.forEach((r) => r());
  await new Promise((r) => setTimeout(r, 0));
  releases.forEach((r) => r());
  await all;
});

test('reports bytes as they arrive, asks for the given priority, and tells about retries', async () => {
  const pieces = [bytes(40), bytes(30), bytes(50)];
  const priorities: (string | undefined)[] = [];
  let busy = 1;
  const fetch = (async (_url: string, init?: RequestInit) => {
    priorities.push(init?.priority);
    if (busy-- > 0) return new Response('busy', { status: 503 });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const piece of pieces) c.enqueue(piece);
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof globalThis.fetch;
  const reports: number[] = [];
  let retries = 0;
  const out = await fetchInRanges('https://slow.example.com/i.ts', {
    limiter: new Limiter(2),
    parallel: 1,
    fetch,
    retryDelayMs: 1,
    fetchPriority: 'low',
    onBytes: (n) => reports.push(n),
    onRetry: () => retries++,
  });
  assert.equal(out.byteLength, 120);
  assert.deepEqual(reports, [40, 30, 50]);
  assert.equal(retries, 1);
  assert.deepEqual(priorities, ['low', 'low']);
});

test('formats short durations', () => {
  assert.equal(shortDuration(45), '45s');
  assert.equal(shortDuration(80), '1:20');
  assert.equal(shortDuration(3725), '1:02:05');
});
