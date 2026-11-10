import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbortError, fetchInRanges, Limiter, LinkExpiredError, shortDuration, streamInRanges } from './range-fetch.ts';

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

/** Everything streamInRanges hands over, joined. */
async function collect(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

test('streams a file as parallel ranges, in order', async () => {
  for (const size of [1000, 1024, 100, 128, 129]) {
    const file = bytes(size);
    const server = fakeServer(file);
    let seen = 0;
    let start: unknown;
    const out = await collect(
      streamInRanges('https://cdn.example.com/a.mp4', {
        limiter: new Limiter(6),
        chunkSize: 128,
        fetch: server.fetch,
        onBytes: (n) => (seen += n),
        onStart: (info) => (start = info),
      }),
    );
    assert.deepEqual(out, file, `size ${size}`);
    assert.equal(seen, size);
    assert.equal((start as { ranges: boolean }).ranges, true);
    if (size >= 1000) assert.ok(server.maxActive() > 1, 'ranges ran side by side');
  }
});

test('streams the whole file in one request when the server ignores Range', async () => {
  const file = bytes(1000);
  const server = fakeServer(file, { ignoreRange: true });
  let start: { ranges: boolean; total: number | null } | undefined;
  const out = await collect(
    streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(6), chunkSize: 128, fetch: server.fetch, onStart: (info) => (start = info) }),
  );
  assert.deepEqual(out, file);
  assert.equal(server.calls.length, 1);
  assert.equal(start?.ranges, false);
});

test('a stream uses Content-Range for the size, and asks for nothing past the end', async () => {
  const file = bytes(1000);
  const calls: string[] = [];
  const fetchWithSize = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range')!;
    calls.push(range);
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number);
    const last = Math.min(to, file.length - 1);
    return new Response(file.slice(from, last + 1), { status: 206, headers: { 'Content-Range': `bytes ${from}-${last}/${file.length}` } });
  }) as typeof fetch;
  let total: number | null = null;
  const out = await collect(
    streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(6), chunkSize: 128, fetch: fetchWithSize, onStart: (info) => (total = info.total) }),
  );
  assert.deepEqual(out, file);
  assert.equal(total, 1000);
  assert.equal(calls.length, 8); // ceil(1000 / 128)
});

test('a stream retries a busy server and fails on an expired link', async () => {
  const file = bytes(600);
  const busy = fakeServer(file, { failFirst: 2 });
  let retries = 0;
  const out = await collect(
    streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(4), chunkSize: 128, fetch: busy.fetch, retryDelayMs: 1, onRetry: () => retries++ }),
  );
  assert.deepEqual(out, file);
  assert.ok(retries >= 2);
  const expired = fakeServer(file, { status: 403 });
  await assert.rejects(collect(streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(4), chunkSize: 128, fetch: expired.fetch })), LinkExpiredError);
});

test('a stream stops when aborted', async () => {
  const server = fakeServer(bytes(5000));
  const controller = new AbortController();
  const stream = streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(4), chunkSize: 128, fetch: server.fetch, signal: controller.signal });
  await stream.next();
  controller.abort();
  await assert.rejects(collect(stream), AbortError);
});

test('a stream falls back to a plain request when the Range request is refused', async () => {
  const file = bytes(700);
  const calls: string[] = [];
  const refusing = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range');
    calls.push(range ?? 'plain');
    if (range) throw new TypeError('Failed to fetch'); // what a refused CORS preflight looks like
    return new Response(file, { status: 200 });
  }) as typeof fetch;
  const out = await collect(streamInRanges('https://cdn.example.com/a.mp4', { limiter: new Limiter(4), chunkSize: 128, fetch: refusing, retryDelayMs: 1 }));
  assert.deepEqual(out, file);
  assert.equal(calls.at(-1), 'plain');
});
