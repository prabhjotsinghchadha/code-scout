// Video tools: save the video playing on the page as an MP4 file.
//
// HLS videos (a playlist of short MPEG-TS segments) are downloaded segment by segment, each as parallel
// byte ranges (range-fetch.ts), and remuxed to MP4 on the fly with Mediabunny: no re-encoding, and the
// file is written to disk as it goes, so memory stays small even for a 2 GB video. A plain video file
// (<video src="….mp4">) is streamed to disk as is.
//
// Runs in the page (the same requests the site's player makes), so the tab has to stay open. Video
// links often carry a token that expires (18JAV: about 2 hours); when a segment says 403, a fresh copy of
// the page is fetched for a new link to the same playlist and the download carries on.
import { Conversion, Input, MPEG_TS, Mp4OutputFormat, Output, ReadableStreamSource, StreamTarget, type StreamTargetChunk } from 'mediabunny';
import {
  downloadProblem,
  findPlaylistLinks,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickVariant,
  type MediaPlaylist,
} from '../shared/hls-playlist';
import { AbortError, fetchInRanges, Limiter, LinkExpiredError } from '../shared/range-fetch';

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
  /** Seconds left, once there's enough to estimate. */
  etaSec: number | null;
}

/** Segments downloaded ahead of the one being written. */
const WINDOW = 4;

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
  private readonly limiter = new Limiter(6);
  private bytes = 0;
  private readonly started = Date.now();
  private readonly source: DownloadSource;
  private readonly filename: string;
  private readonly onProgress: (p: DownloadProgress) => void;

  constructor(source: DownloadSource, filename: string, onProgress: (p: DownloadProgress) => void) {
    this.source = source;
    this.filename = filename;
    this.onProgress = onProgress;
  }

  cancel() {
    this.controller.abort();
    void this.conversion?.cancel().catch(() => {});
  }

  /** Call from a click: it starts with the "Save as" dialog, which needs one. Resolves when saved. */
  async run(): Promise<void> {
    const picker = (window as Window & { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (!picker) throw new Error('This browser can’t save files from a page (needs Chrome 86 or newer).');
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: this.filename,
        types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
      });
    } catch {
      throw new CancelledError(); // closed the dialog
    }
    // Written through our own writer, so a failed or cancelled download discards the half-written file:
    // the MP4 writer *closes* its stream when cancelled, which would keep it.
    const writer = (await handle.createWritable()).getWriter();
    const writable = new WritableStream<unknown>({
      write: (chunk) => writer.write(chunk as FileSystemWriteChunkType),
      close: () => (this.failed || this.controller.signal.aborted ? writer.abort() : writer.close()),
      abort: (reason) => writer.abort(reason),
    });
    try {
      if (this.source.fileUrl) await this.saveFile(this.source.fileUrl, writable);
      else if (this.source.playlistUrl) await this.saveHls(this.source.playlistUrl, writable);
      else throw new Error('No video found to download.');
    } catch (err) {
      await writer.abort().catch(() => {});
      await (handle as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => {});
      throw this.controller.signal.aborted ? new CancelledError() : err;
    }
  }

  private report(fraction: number) {
    const elapsed = (Date.now() - this.started) / 1000;
    const etaSec = fraction > 0.01 && elapsed > 5 ? (elapsed / fraction) * (1 - fraction) : null;
    this.onProgress({ fraction, bytes: this.bytes, etaSec });
  }

  private async saveFile(url: string, writable: WritableStream<unknown>) {
    const response = await fetch(url, { signal: this.controller.signal });
    if (!response.ok || !response.body) throw new Error(`The video server answered HTTP ${response.status}.`);
    const total = Number(response.headers.get('content-length')) || 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, c) => {
        this.bytes += chunk.byteLength;
        this.report(total ? this.bytes / total : 0);
        c.enqueue(chunk);
      },
    });
    await response.body.pipeThrough(counter).pipeTo(writable, { signal: this.controller.signal });
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

    const fetchSegment = async (i: number): Promise<Uint8Array> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fetchInRanges(segments[i], {
            limiter: this.limiter,
            priority: i,
            signal,
            parallel: 4,
            onBytes: (n) => (this.bytes += n),
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
      while (started < total && started < next + WINDOW) {
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
          this.report(next / total);
          c.enqueue(bytes);
        },
        cancel: () => this.controller.abort(),
      },
      { highWaterMark: 0 },
    );

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
