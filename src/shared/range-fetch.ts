// Parallel downloads for slow video servers. Some CDNs limit each request to a few dozen KB/s, but let
// several run at once; so each file is fetched as several byte ranges ("Range: bytes=…") side by side,
// and a Limiter caps how many requests are in flight overall.
//
// Used by the page-side parallel loader (video-boost.iife.ts) and the downloader (video-download.ts),
// so no chrome.* APIs here.

export const CHUNK_SIZE = 256 * 1024;

/** The link stopped working (403/401/410): sites put an expiring token in video links. */
export class LinkExpiredError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The video link expired (HTTP ${status}).`);
    this.status = status;
  }
}

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

interface Waiting {
  priority: number;
  order: number;
  start: () => void;
}

/** Runs at most `max` tasks at once; waiting tasks start lowest `priority` first, then in order. */
export class Limiter {
  private running = 0;
  private queue: Waiting[] = [];
  private order = 0;
  private limit: number;

  constructor(max: number) {
    this.limit = max;
  }

  get max() {
    return this.limit;
  }

  /** Change how many run at once: more start straight away; fewer, as running ones finish. */
  setMax(max: number) {
    this.limit = Math.max(1, max);
    this.next();
  }

  get active() {
    return this.running;
  }

  run<T>(task: () => Promise<T>, priority = 0, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortError());
      const waiting: Waiting = {
        priority,
        order: this.order++,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.running++;
          task()
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.next();
            });
        },
      };
      const onAbort = () => {
        this.queue = this.queue.filter((w) => w !== waiting);
        reject(new AbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiting);
      this.next();
    });
  }

  private next() {
    while (this.running < this.limit && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i];
        const b = this.queue[best];
        if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
      }
      this.queue.splice(best, 1)[0].start();
    }
  }
}

export interface RangeFetchOptions {
  limiter: Limiter;
  /** Lower starts first (e.g. the segment's position in the video). */
  priority?: number;
  signal?: AbortSignal;
  chunkSize?: number;
  /** Ranges of this file requested at the same time (the limiter still caps the total). */
  parallel?: number;
  /** Attempts per range before giving up (network errors, 5xx, 429). */
  attempts?: number;
  /** Called as bytes arrive, for progress and speed. */
  onBytes?: (bytes: number) => void;
  /** Called when a range is about to be tried again (busy server, network error). */
  onRetry?: () => void;
  /**
   * The browser's priority for the requests. 'low' lets other requests to the same server go first
   * (a download leaves the playing video its turn).
   */
  fetchPriority?: RequestPriority;
  /** For tests. */
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

type ChunkResult =
  | { kind: 'part'; bytes: Uint8Array } // 206
  | { kind: 'whole'; bytes: Uint8Array } // 200: the server ignored Range and sent the whole file
  | { kind: 'past-end' }; // 416

const EXPIRED = new Set([401, 403, 410]);

/** Hosts that answered a Range request with the whole file: fetch their files in one request. */
const noRangeHosts = new Set<string>();
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/** Download `url` as parallel byte ranges and return the whole file. */
export async function fetchInRanges(url: string, options: RangeFetchOptions): Promise<Uint8Array> {
  const { limiter, priority = 0, chunkSize = CHUNK_SIZE, attempts = 3, onBytes, onRetry, fetchPriority, retryDelayMs = 500 } = options;
  const host = hostOf(url);
  const parallel = noRangeHosts.has(host) ? 1 : (options.parallel ?? 4);
  const doFetch = options.fetch ?? fetch.bind(globalThis);

  // One controller for this file: stop the other ranges as soon as one fails for good.
  const controller = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) throw new AbortError();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const signal = controller.signal;

  const fetchChunk = async (index: number): Promise<ChunkResult> => {
    const from = index * chunkSize;
    for (let attempt = 1; ; attempt++) {
      let error: unknown;
      let retryable = true; // network errors and 429/5xx are worth another try
      try {
        const init: RequestInit = { headers: { Range: `bytes=${from}-${from + chunkSize - 1}` }, signal };
        if (fetchPriority) init.priority = fetchPriority;
        const response = await doFetch(url, init);
        if (response.status === 416) return { kind: 'past-end' };
        if (EXPIRED.has(response.status)) throw new LinkExpiredError(response.status);
        if (response.status === 206 || response.status === 200) {
          const bytes = await readBody(response, onBytes);
          return response.status === 206 ? { kind: 'part', bytes } : { kind: 'whole', bytes };
        }
        error = new Error(`HTTP ${response.status}`);
        retryable = response.status === 429 || response.status >= 500;
      } catch (err) {
        if (signal.aborted) throw new AbortError();
        if (err instanceof LinkExpiredError) throw err;
        error = err;
      }
      if (!retryable || attempt >= attempts) throw error;
      onRetry?.();
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      if (signal.aborted) throw new AbortError();
    }
  };

  const parts: Uint8Array[] = [];
  let whole: Uint8Array | null = null;
  let end = Infinity; // number of chunks in the file, once known
  let next = 0;
  let failure: unknown = null;
  const inFlight = new Set<Promise<void>>();

  const launch = (index: number) => {
    const p = limiter
      .run(() => fetchChunk(index), priority, signal)
      .then((result) => {
        if (result.kind === 'whole') {
          whole ??= result.bytes;
          end = 0;
          noRangeHosts.add(host);
        } else if (result.kind === 'past-end') {
          end = Math.min(end, index);
        } else {
          parts[index] = result.bytes;
          if (result.bytes.byteLength < chunkSize) end = Math.min(end, index + 1);
        }
      })
      .catch((err) => {
        failure ??= err;
        controller.abort();
      })
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  };

  try {
    while (!failure) {
      while (inFlight.size < parallel && next < end && !whole) launch(next++);
      if (!inFlight.size) break;
      await Promise.race(inFlight);
    }
    await Promise.allSettled(inFlight);
    if (failure) throw failure instanceof AbortError && outer?.aborted ? new AbortError() : failure;
    if (whole) return whole;
    if (end === Infinity || end === 0) throw new Error('Empty response');
    return joinParts(parts, end);
  } finally {
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Size of the ranges a big file is streamed in (streamInRanges). */
export const STREAM_CHUNK_SIZE = 4 * 1024 * 1024;

export interface RangeStreamOptions {
  limiter: Limiter;
  signal?: AbortSignal;
  chunkSize?: number;
  /** Ranges fetched ahead of the one being handed over, read each time more are started (memory: this × chunkSize). */
  ahead?: () => number;
  attempts?: number;
  /** Bytes as they arrive; negative when a range that broke off is fetched again. */
  onBytes?: (bytes: number) => void;
  onRetry?: () => void;
  /** Once the first answer is in: whether the server does ranges, and the file's size if it said. */
  onStart?: (info: { ranges: boolean; total: number | null }) => void;
  fetchPriority?: RequestPriority;
  /** For tests. */
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

/**
 * A big file (a plain MP4) as parallel byte ranges, handed over in order as they're ready, so it can be
 * written to disk as it goes. For servers that slow each request down but allow several at once.
 * A server that ignores Range and sends the whole file is streamed as it comes, in one request.
 * Where the file ends is learned from Content-Range if the page may read it, else from the first range
 * that comes back short or past the end.
 */
export async function* streamInRanges(url: string, options: RangeStreamOptions): AsyncGenerator<Uint8Array, void, undefined> {
  const { limiter, chunkSize = STREAM_CHUNK_SIZE, attempts = 3, onBytes, onRetry, fetchPriority, retryDelayMs = 500 } = options;
  const ahead = options.ahead ?? (() => limiter.max + 2);
  const doFetch = options.fetch ?? fetch.bind(globalThis);

  const controller = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) throw new AbortError();
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const signal = controller.signal;

  // Later ranges go straight to where the first one ended up (a link that redirects to the file server).
  let target = url;

  type Answer = { kind: 'part'; bytes: Uint8Array; total: number | null } | { kind: 'past-end' } | { kind: 'whole'; response: Response };

  const fetchChunk = async (index: number): Promise<Answer> => {
    const from = index * chunkSize;
    for (let attempt = 1; ; attempt++) {
      let error: unknown;
      let retryable = true;
      let counted = 0;
      try {
        const init: RequestInit = { headers: { Range: `bytes=${from}-${from + chunkSize - 1}` }, signal };
        if (fetchPriority) init.priority = fetchPriority;
        const response = await doFetch(target, init);
        if (index === 0 && response.ok && /^https?:/i.test(response.url)) target = response.url;
        if (response.status === 416) return { kind: 'past-end' };
        if (EXPIRED.has(response.status)) throw new LinkExpiredError(response.status);
        if (response.status === 200) {
          if (index === 0) return { kind: 'whole', response };
          void response.body?.cancel().catch(() => {});
          throw new Error('The video server stopped answering range requests.');
        }
        if (response.status === 206) {
          const size = Number(/\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '')?.[1]);
          const bytes = await readBody(response, (n) => {
            counted += n;
            onBytes?.(n);
          });
          return { kind: 'part', bytes, total: size > 0 ? size : null };
        }
        error = new Error(`HTTP ${response.status}`);
        retryable = response.status === 429 || response.status >= 500;
      } catch (err) {
        if (signal.aborted) throw new AbortError();
        if (err instanceof LinkExpiredError) throw err;
        error = err;
        if (counted) onBytes?.(-counted); // the range starts again
      }
      if (!retryable || attempt >= attempts) throw error;
      onRetry?.();
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      if (signal.aborted) throw new AbortError();
    }
  };

  /** The file's size from a plain request's headers (its body isn't read), or null. */
  const sizeOf = async (): Promise<number | null> => {
    const probe = new AbortController();
    const stop = () => probe.abort();
    signal.addEventListener('abort', stop, { once: true });
    try {
      const response = await doFetch(target, { signal: probe.signal });
      const size = response.status === 200 ? Number(response.headers.get('content-length')) : 0;
      return size > 0 ? size : null;
    } catch {
      return null;
    } finally {
      probe.abort();
      signal.removeEventListener('abort', stop);
    }
  };

  try {
    let first: Answer;
    try {
      first = await limiter.run(() => fetchChunk(0), 0, signal);
    } catch (err) {
      if (signal.aborted || err instanceof LinkExpiredError) throw err;
      // A server (or its CORS rules) that refuses a Range request: the plain request, as a page's own player sends.
      const response = await doFetch(url, { signal });
      if (EXPIRED.has(response.status)) throw new LinkExpiredError(response.status);
      if (!response.ok) throw err;
      first = { kind: 'whole', response };
    }
    if (first.kind === 'past-end') throw new Error('Empty response');
    if (first.kind === 'whole') {
      const { response } = first;
      options.onStart?.({ ranges: false, total: Number(response.headers.get('content-length')) || null });
      if (!response.body) throw new Error('Empty response');
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        onBytes?.(value.byteLength);
        yield value;
      }
    }
    const whole = first.bytes.byteLength < chunkSize;
    // The size, for the progress: Content-Range, else (the page may not read it) the plain request's Content-Length.
    const total = first.total ?? (whole ? first.bytes.byteLength : await sizeOf());
    options.onStart?.({ ranges: true, total });
    yield first.bytes;
    if (whole) return;

    let end = total ? Math.ceil(total / chunkSize) : Infinity; // number of ranges in the file
    let started = 1;
    let next = 1;
    const pending = new Map<number, Promise<Answer>>();
    const fill = () => {
      while (started < end && started < next + Math.max(1, ahead())) {
        const index = started++;
        const p = limiter
          .run(() => fetchChunk(index), index, signal)
          .then((answer) => {
            if (answer.kind === 'past-end') end = Math.min(end, index);
            else if (answer.kind === 'part' && answer.bytes.byteLength < chunkSize) end = Math.min(end, index + 1);
            return answer;
          });
        p.catch(() => {}); // awaited when its turn comes
        pending.set(index, p);
      }
    };
    while (next < end) {
      fill();
      const answer = await pending.get(next)!;
      pending.delete(next++);
      if (answer.kind !== 'part') return;
      yield answer.bytes;
    }
  } catch (err) {
    throw err instanceof AbortError || signal.aborted ? new AbortError() : err;
  } finally {
    controller.abort(); // ranges started past the end, or still running when the reader stopped
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** The response's bytes, reported to `onBytes` as they arrive (a range can take seconds on a slow server). */
async function readBody(response: Response, onBytes?: (bytes: number) => void): Promise<Uint8Array> {
  if (!onBytes || !response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes?.(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
    onBytes(value.byteLength);
  }
  return pieces.length === 1 ? pieces[0] : joinParts(pieces, pieces.length);
}

export function joinParts(parts: Uint8Array[], count: number): Uint8Array {
  let size = 0;
  for (let i = 0; i < count; i++) {
    if (!parts[i]) throw new Error(`Missing part ${i}`);
    size += parts[i].byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < count; i++) {
    out.set(parts[i], offset);
    offset += parts[i].byteLength;
  }
  return out;
}

/** "1:20" / "45s" for a number of seconds. */
export function shortDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
