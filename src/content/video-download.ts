// Video tools: save the video playing on the page as an MP4 file.
//
// HLS videos (a playlist of short MPEG-TS segments) are downloaded segment by segment, each as parallel
// byte ranges (range-fetch.ts), and remuxed to MP4 on the fly with Mediabunny: no re-encoding, and the
// file is written to disk as it goes, so memory stays small even for a 2 GB video. A plain video file
// (<video src="….mp4">) is saved as it is, also downloaded as parallel byte ranges and written in order.
//
// How many requests run at once is measured as it goes (parallel-tuner.ts): 6 to begin with, more while
// more turns out faster (servers that slow down each request), up to 24. They're sent at low priority,
// so a video playing meanwhile still gets its segments first; and the page's faster loading
// (video-boost.iife.ts) fetches less ahead while a download runs ("javtr:downloading").
//
// Runs in the page (the same requests the site's player makes), so the tab has to stay open. In a player
// embedded from another site, the top page shows "Save as" and writes the file (frame-bridge.ts). Video
// links often carry a token that expires (18JAV: about 2 hours); when a segment says 403, a fresh copy of
// the page is fetched for a new link to the same playlist and the download carries on.
import {
  Conversion,
  Input,
  Logging,
  LogLevel,
  MPEG_TS,
  Mp4OutputFormat,
  Output,
  ReadableStreamSource,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import {
  downloadProblem,
  findPlaylistLinks,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickVariant,
  type MediaPlaylist,
} from '../shared/hls-playlist';
import { ParallelTuner } from '../shared/parallel-tuner';
import { AbortError, fetchInRanges, Limiter, LinkExpiredError, streamInRanges } from '../shared/range-fetch';
import { inForeignFrame, pickSaveTarget, saveInPage, type SaveTarget } from './frame-bridge';

export interface DownloadSource {
  /** Master or media playlist (.m3u8). */
  playlistUrl?: string;
  /** The media playlist of the quality playing, to pick the same one from a master playlist. */
  playingUrl?: string;
  /** A plain video file. */
  fileUrl?: string;
}

export interface DownloadProgress {
  /** 0–1 */
  fraction: number;
  bytes: number;
  /** Bytes per second over the last few seconds, once there's enough to tell. */
  speed: number | null;
  /** Seconds left, once there's enough to estimate. */
  etaSec: number | null;
  /** Requests at once (null: one request, the server doesn't do ranges). */
  parallel: number | null;
}

// Mediabunny's warnings are notes, not failures (e.g. "stream_type 0x15 not supported": the ID3 timestamps
// many HLS streams carry, which it skips while still saving the video and audio). console.warn from a content
// script lands on the extension's Errors page, so they go to DevTools' Verbose level instead.
Logging.level = LogLevel.Errors;
Logging.on('warn', (args) => console.debug('[mediabunny]', ...args));

/** Requests at once to begin with, and at most (see ParallelTuner). */
const PARALLEL_START = 6;
const PARALLEL_MAX = 24;
/** Segments downloaded ahead of the one being written: enough to keep every request busy, even when a segment is only two ranges. */
const windowFor = (parallel: number) => Math.max(4, Math.ceil(parallel / 2));
/** Speed is averaged over this long. */
const SPEED_WINDOW_MS = 10_000;

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export class VideoDownload {
  private readonly controller = new AbortController();
  /** A segment couldn't be downloaded: the file must not be kept. */
  private failed = false;
  private conversion: Conversion | null = null;
  private readonly limiter = new Limiter(PARALLEL_START);
  private bytes = 0;
  private fraction = 0;
  private started = Date.now();
  /** Recent [time, bytes] readings, for the speed. */
  private samples: [number, number][] = [];
  private speed: number | null = null;
  /** Requests at once (null: a plain file from a server that doesn't do ranges, one request). */
  private parallel: number | null = null;
  /** Called every second while downloading (the HLS download tunes its requests). */
  private onTick: ((now: number) => void) | null = null;
  private readonly source: DownloadSource;
  private readonly filename: string | Promise<string>;
  private readonly onProgress: (p: DownloadProgress) => void;

  constructor(source: DownloadSource, filename: string | Promise<string>, onProgress: (p: DownloadProgress) => void) {
    this.source = source;
    this.filename = filename;
    this.onProgress = onProgress;
  }

  cancel() {
    this.controller.abort();
    void this.conversion?.cancel().catch(() => {});
  }

  /** Call from a click: it starts with the "Save as" dialog, which needs one. Resolves to the file's name once saved. */
  async run(): Promise<string> {
    const name = await this.filename;
    const target = inForeignFrame() ? await this.saveInPage(name) : await this.saveHere(name);
    // Written through our own writer, so a failed or cancelled download discards the half-written file:
    // the MP4 writer *closes* its stream when cancelled, which would keep it.
    const writable = new WritableStream<unknown>({
      write: (chunk) => target.write(chunk),
      close: () => (this.failed || this.controller.signal.aborted ? target.abort() : target.close()),
      abort: () => target.abort(),
    });
    this.started = Date.now(); // not counting the time in the dialog
    const ticker = setInterval(() => this.tick(), 1000);
    try {
      if (this.source.fileUrl) await this.saveFile(this.source.fileUrl, writable);
      else if (this.source.playlistUrl) await this.saveHls(this.source.playlistUrl, writable);
      else throw new Error('No video found to download.');
    } catch (err) {
      await target.abort().catch(() => {});
      throw this.controller.signal.aborted ? new CancelledError() : err;
    } finally {
      clearInterval(ticker);
      this.onTick = null;
    }
    return target.name;
  }

  private async saveHere(name: string): Promise<SaveTarget> {
    const target = await pickSaveTarget(name);
    if ('cancelled' in target) throw new CancelledError();
    return target;
  }

  private async saveInPage(name: string): Promise<SaveTarget> {
    const answer = await saveInPage(name);
    if ('cancelled' in answer) throw new CancelledError();
    if ('error' in answer) throw new Error(answer.error);
    return answer;
  }

  private tick() {
    const now = Date.now();
    this.samples.push([now, this.bytes]);
    while (now - this.samples[0][0] > SPEED_WINDOW_MS) this.samples.shift();
    const [t0, b0] = this.samples[0];
    this.speed = now - t0 >= 3000 ? ((this.bytes - b0) * 1000) / (now - t0) : null;
    this.onTick?.(now);
    this.report();
  }

  private report() {
    const { fraction, bytes, speed } = this;
    let etaSec: number | null = null;
    if (fraction > 0.01 && speed) {
      // From the recent speed, so it follows speed-ups. The size is guessed from the share done so far.
      etaSec = Math.max(0, (bytes / fraction - bytes) / speed);
    } else {
      const elapsed = (Date.now() - this.started) / 1000;
      if (fraction > 0.01 && elapsed > 5) etaSec = (elapsed / fraction) * (1 - fraction);
    }
    this.onProgress({ fraction, bytes, speed, etaSec, parallel: this.parallel });
  }

  /**
   * A plain video file: as parallel byte ranges written in order (streamInRanges), since the servers that
   * hold such files often slow each request down. One request, as it comes, if the server doesn't do ranges.
   */
  private async saveFile(url: string, writable: WritableStream<unknown>) {
    const tuner = new ParallelTuner(Date.now(), { start: PARALLEL_START, max: PARALLEL_MAX });
    const setParallel = (limit: number | null) => {
      if (limit === null) return;
      this.limiter.setMax(limit);
      this.parallel = limit;
    };
    let total = 0;
    const chunks = streamInRanges(url, {
      limiter: this.limiter,
      signal: this.controller.signal,
      fetchPriority: 'low', // a video playing meanwhile keeps its turn
      onBytes: (n) => {
        this.bytes += n;
        this.fraction = total ? Math.min(1, this.bytes / total) : 0;
      },
      onRetry: () => setParallel(tuner.backOff(Date.now())),
      onStart: (info) => {
        total = info.total ?? 0;
        if (!info.ranges) return;
        this.parallel = tuner.limit;
        this.onTick = (now) => setParallel(tuner.update(now, this.bytes));
      },
    });
    const writer = writable.getWriter();
    try {
      for await (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    } catch (err) {
      this.failed = true;
      await writer.abort(err).catch(() => {});
      throw err;
    }
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, { signal: this.controller.signal });
    if (response.status === 401 || response.status === 403 || response.status === 410) throw new LinkExpiredError(response.status);
    if (!response.ok) throw new Error(`The video server answered HTTP ${response.status}.`);
    return response.text();
  }

  /** The media playlist behind `url` (picking a quality if it's a master playlist). */
  private async loadPlaylist(url: string, playingUrl?: string): Promise<{ url: string; playlist: MediaPlaylist }> {
    const text = await this.fetchText(url);
    if (!isMasterPlaylist(text)) return { url, playlist: parseMediaPlaylist(text, url) };
    const variant = pickVariant(parseMasterPlaylist(text, url), playingUrl);
    if (!variant) throw new Error('The video’s playlist lists no qualities.');
    return { url: variant.url, playlist: parseMediaPlaylist(await this.fetchText(variant.url), variant.url) };
  }

  private async saveHls(playlistUrl: string, writable: WritableStream<unknown>) {
    let { playlist } = await this.loadPlaylist(playlistUrl, this.source.playingUrl);
    const problem = downloadProblem(playlist);
    if (problem) throw new Error(problem);
    const segments = [...playlist.segments];
    const total = segments.length;
    const signal = this.controller.signal;

    // A fresh link when the old one expires: same playlist file name in a new copy of the page.
    let linkUrl = playlistUrl;
    let refreshing: Promise<void> | null = null;
    const refreshLinks = () =>
      (refreshing ??= (async () => {
        const html = await (await fetch(location.href, { credentials: 'include', signal })).text();
        for (const candidate of findPlaylistLinks(html, linkUrl)) {
          const fresh = await this.loadPlaylist(candidate, this.source.playingUrl).catch(() => null);
          if (fresh && fresh.playlist.segments.length === total) {
            playlist = fresh.playlist;
            segments.splice(0, total, ...fresh.playlist.segments);
            linkUrl = candidate;
            return;
          }
        }
        throw new Error('The video link expired. Reload the page and start the download again.');
      })().finally(() => setTimeout(() => (refreshing = null), 10_000)));

    // Requests at once: more while more turns out faster (see the top of this file).
    const tuner = new ParallelTuner(Date.now(), { start: PARALLEL_START, max: PARALLEL_MAX });
    this.parallel = tuner.limit;
    const setParallel = (limit: number | null) => {
      if (limit === null) return;
      this.limiter.setMax(limit);
      this.parallel = limit;
      fill(); // more segments ahead to keep them busy
    };

    const fetchSegment = async (i: number): Promise<Uint8Array> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fetchInRanges(segments[i], {
            limiter: this.limiter,
            priority: i,
            signal,
            parallel: 4,
            fetchPriority: 'low',
            onBytes: (n) => (this.bytes += n),
            onRetry: () => setParallel(tuner.backOff(Date.now())),
          });
        } catch (err) {
          if (!(err instanceof LinkExpiredError) || attempt >= 2) throw err;
          await refreshLinks();
        }
      }
    };

    const ready = new Map<number, Promise<Uint8Array>>();
    let started = 0;
    let next = 0;
    const fill = () => {
      while (started < total && started < next + windowFor(this.limiter.max)) {
        const p = fetchSegment(started);
        p.catch(() => {}); // awaited when its turn comes
        ready.set(started++, p);
      }
    };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: async (c) => {
          if (next >= total) return c.close();
          fill();
          let bytes: Uint8Array;
          try {
            bytes = await ready.get(next)!;
          } catch (err) {
            this.failed = true;
            throw err;
          }
          ready.delete(next++);
          fill();
          this.fraction = next / total;
          this.report();
          c.enqueue(bytes);
        },
        cancel: () => this.controller.abort(),
      },
      { highWaterMark: 0 },
    );

    this.onTick = (now) => setParallel(tuner.update(now, this.bytes));

    const input = new Input({ source: new ReadableStreamSource(stream), formats: [MPEG_TS] });
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    });
    // No onProgress on the conversion: it would read the whole input first to learn the duration.
    this.conversion = await Conversion.init({ input, output });
    if (signal.aborted) throw new AbortError();
    if (!this.conversion.isValid) throw new Error('This video can’t be saved as MP4 (unsupported codec).');
    await this.conversion.execute(); // closes the file when done
  }
}

/** "PMX-046.mp4" from the video's code, else its title, without characters file systems refuse. */
export function downloadFileName(code: string | null, title: string): string {
  const name = (code || title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${name || 'video'}.mp4`;
}
