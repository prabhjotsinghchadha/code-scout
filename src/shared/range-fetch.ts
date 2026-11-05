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

  readonly max: number;

  constructor(max: number) {
    this.max = max;
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
    while (this.running < this.max && this.queue.length) {
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
  const { limiter, priority = 0, chunkSize = CHUNK_SIZE, attempts = 3, onBytes, retryDelayMs = 500 } = options;
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
        const response = await doFetch(url, { headers: { Range: `bytes=${from}-${from + chunkSize - 1}` }, signal });
        if (response.status === 416) return { kind: 'past-end' };
        if (EXPIRED.has(response.status)) throw new LinkExpiredError(response.status);
        if (response.status === 206 || response.status === 200) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          onBytes?.(bytes.byteLength);
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
