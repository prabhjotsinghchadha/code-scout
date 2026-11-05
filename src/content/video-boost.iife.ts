// Video tools, page side: faster loading and the quality menu for players built on hls.js.
// Runs in the page's own JavaScript world at document_start, in every frame of sites where "Video tools"
// is on (the background registers it with chrome.scripting). A player embedded on a page where they're
// turned off gets "javtr:video-off" from the content script, and loads normally from then on.
//
// Some video servers send each request slowly (18JAV's CDN: about 50 KB/s per request, while the video
// needs about 250 KB/s) but let several requests run at once. So the site's hls.js gets a loader that
// downloads each segment as parallel byte ranges and fetches the next segments ahead, then hands hls.js
// the finished bytes through a blob: URL, which hls.js's own loader reads instantly. Anything unusual
// (byte-range segments, a failed range request) falls back to hls.js's normal loading.
//
// It also reports each player's state (qualities, how far ahead it has loaded, the playlist URL for
// downloads) to the content script with a "javtr:video-info" event on the <video>, and switches
// quality on "javtr:set-level". No chrome.* APIs here.
import { isMasterPlaylist, isPlaylist, parseMediaPlaylist } from '../shared/hls-playlist';
import { fetchInRanges, Limiter } from '../shared/range-fetch';

/* eslint-disable @typescript-eslint/no-explicit-any -- hls.js is the site's, with no types here */
type Loose = any;

(() => {
  const w = window as Window & { __javtrVideoBoost?: boolean };
  if (w.__javtrVideoBoost) return;
  w.__javtrVideoBoost = true;

  /** Requests at once to the video server. */
  const PARALLEL = 6;
  /** Segments fetched ahead of the one the player asked for (about 2 min of video while playing). */
  const AHEAD_PLAYING = 30;
  const AHEAD_PAUSED = 4;
  const limiter = new Limiter(PARALLEL);

  interface Position {
    list: string[];
    durations: number[];
    index: number;
  }
  interface Job {
    promise: Promise<Uint8Array>;
    controller: AbortController;
    done: boolean;
    duration: number;
  }
  /** Segment URL → where it is in its playlist. */
  const positions = new Map<string, Position>();
  /** Segments being fetched or fetched ahead, not yet handed to the player. */
  const jobs = new Map<string, Job>();
  /** When the player last asked for a segment of each playlist. */
  const lastAsked = new Map<string[], number>();
  const players = new Map<HTMLMediaElement, Loose>();

  const anyPlaying = () => [...players.keys()].some((m) => !m.paused);

  let off = false;
  window.addEventListener('javtr:video-off', () => {
    off = true;
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  });

  function recordPlaylist(text: string, url: string) {
    if (!isPlaylist(text) || isMasterPlaylist(text)) return;
    const playlist = parseMediaPlaylist(text, url);
    if (playlist.byteRanges) return;
    const list = playlist.segments;
    list.forEach((segment, index) => positions.set(segment, { list, durations: playlist.durations, index }));
  }

  function start(url: string, pos: Position, index: number) {
    if (jobs.has(url)) return;
    const controller = new AbortController();
    const job: Job = {
      controller,
      done: false,
      duration: pos.durations[index] ?? 0,
      promise: fetchInRanges(url, { limiter, priority: index, signal: controller.signal, parallel: 4 }),
    };
    job.promise.then(
      () => (job.done = true),
      () => {
        // Not handed out yet: forget it, so the player's request starts afresh.
        if (jobs.get(url) === job) jobs.delete(url);
      },
    );
    jobs.set(url, job);
  }

  /** The player wants segment `url`: its bytes (fetched ahead, or now), or null to load it normally. */
  function want(url: string): Promise<Uint8Array> | null {
    const pos = positions.get(url);
    if (!pos || off) return null;
    const now = Date.now();
    lastAsked.set(pos.list, now);
    for (const [u, job] of jobs) {
      const p = positions.get(u);
      const stale =
        !p ||
        (p.list === pos.list && (p.index < pos.index || p.index > pos.index + AHEAD_PLAYING)) || // after a seek
        (p.list !== pos.list && now - (lastAsked.get(p.list) ?? 0) > 30_000); // a quality no longer played
      if (stale) {
        job.controller.abort();
        jobs.delete(u);
      }
    }
    const ahead = anyPlaying() ? AHEAD_PLAYING : AHEAD_PAUSED;
    for (let i = pos.index; i <= Math.min(pos.list.length - 1, pos.index + ahead); i++) start(pos.list[i], pos, i);
    const job = jobs.get(url);
    jobs.delete(url); // handed to the player
    return job?.promise ?? null;
  }

  const isSegment = (context: Loose) =>
    !!context?.frag &&
    !context.part &&
    context.responseType === 'arraybuffer' &&
    !(typeof context.rangeEnd === 'number' && context.rangeEnd > 0);

  const isPlaylistLoad = (context: Loose) => !context?.frag && typeof context?.type === 'string';

  /** hls.js's loader, with segments fetched in parallel ranges and playlists remembered. */
  function turboLoader(Base: Loose): Loose {
    return class TurboLoader extends Base {
      javtrToken: object | null = null;

      load(context: Loose, config: Loose, callbacks: Loose) {
        const token = {};
        this.javtrToken = token;
        if (isSegment(context)) {
          let pending: Promise<Uint8Array> | null = null;
          try {
            pending = want(context.url);
          } catch {
            pending = null;
          }
          if (pending) {
            pending.then(
              (bytes) => {
                if (this.javtrToken !== token) return; // aborted meanwhile
                const original = context.url;
                const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
                const finish = () => {
                  URL.revokeObjectURL(blobUrl);
                  context.url = original;
                };
                context.url = blobUrl;
                super.load(context, config, {
                  ...callbacks,
                  onSuccess: (response: Loose, ...rest: Loose[]) => {
                    finish();
                    if (response && typeof response === 'object') response.url = original;
                    callbacks.onSuccess(response, ...rest);
                  },
                  onError: (...args: Loose[]) => {
                    finish();
                    callbacks.onError(...args);
                  },
                  onTimeout: (...args: Loose[]) => {
                    finish();
                    callbacks.onTimeout?.(...args);
                  },
                });
              },
              () => {
                if (this.javtrToken === token) super.load(context, config, callbacks);
              },
            );
            return;
          }
        } else if (isPlaylistLoad(context)) {
          const onSuccess = callbacks.onSuccess;
          callbacks = {
            ...callbacks,
            onSuccess: (response: Loose, ...rest: Loose[]) => {
              try {
                if (typeof response?.data === 'string') recordPlaylist(response.data, response.url || context.url);
              } catch {
                // Not a playlist we understand; parallel loading just stays off for it.
              }
              onSuccess(response, ...rest);
            },
          };
        }
        super.load(context, config, callbacks);
      }

      abort() {
        this.javtrToken = null;
        super.abort();
      }

      destroy() {
        this.javtrToken = null;
        super.destroy();
      }
    };
  }

  // --- Player state for the toolbar, and quality switching ---
  function levelUrl(hls: Loose): string {
    const index = hls.currentLevel >= 0 ? hls.currentLevel : (hls.loadLevel ?? 0);
    const level = hls.levels?.[index];
    const url = level?.url ?? level?.uri;
    return (Array.isArray(url) ? url[0] : url) ?? '';
  }

  function bufferedAhead(media: HTMLMediaElement): number {
    const t = media.currentTime;
    for (let i = 0; i < media.buffered.length; i++) {
      if (media.buffered.start(i) <= t + 0.5 && media.buffered.end(i) >= t) return media.buffered.end(i) - t;
    }
    return 0;
  }

  function report() {
    const fetchedAhead = [...jobs.values()].reduce((sum, job) => sum + (job.done ? job.duration : 0), 0);
    for (const [media, hls] of players) {
      if (hls.media !== media) {
        players.delete(media);
        continue;
      }
      const info = {
        manifestUrl: String(hls.url ?? ''),
        levelUrl: levelUrl(hls),
        levels: (hls.levels ?? []).map((l: Loose) => ({ height: l.height ?? 0, width: l.width ?? 0, bitrate: l.bitrate ?? 0 })),
        currentLevel: hls.currentLevel ?? -1,
        auto: !!hls.autoLevelEnabled,
        aheadSec: bufferedAhead(media) + fetchedAhead,
      };
      media.dispatchEvent(new CustomEvent('javtr:video-info', { detail: JSON.stringify(info) }));
    }
    if (!players.size) {
      clearInterval(reporting);
      reporting = undefined;
    }
  }
  let reporting: ReturnType<typeof setInterval> | undefined;

  function track(hls: Loose, media: unknown) {
    if (!(media instanceof HTMLMediaElement)) return;
    if (!players.has(media)) {
      media.addEventListener('javtr:set-level', (e) => {
        const level = Number((e as CustomEvent).detail);
        const player = players.get(media);
        if (player && Number.isInteger(level)) player.currentLevel = level; // -1 = automatic
      });
    }
    players.set(media, hls);
    reporting ??= setInterval(report, 1000);
  }

  function patchHls(Hls: Loose): Loose {
    if (typeof Hls !== 'function' || Hls.__javtrPatched) return Hls;
    try {
      Hls.__javtrPatched = true;
      const config = Hls.DefaultConfig;
      if (config && typeof config.loader === 'function') {
        config.loader = turboLoader(config.loader);
        config.maxBufferLength = Math.max(config.maxBufferLength ?? 30, 60);
        config.maxBufferSize = Math.max(config.maxBufferSize ?? 60e6, 150e6);
      }
      const attachMedia = Hls.prototype?.attachMedia;
      if (typeof attachMedia === 'function') {
        Hls.prototype.attachMedia = function (this: Loose, media: unknown) {
          track(this, media);
          return attachMedia.call(this, media);
        };
      }
    } catch (err) {
      console.warn('[Code Scout] Could not speed up this player:', err);
    }
    return Hls;
  }

  // hls.js loaded as a plain <script> sets window.Hls: patch it the moment it's defined.
  let hls = patchHls((w as Loose).Hls);
  try {
    Object.defineProperty(window, 'Hls', {
      configurable: true,
      enumerable: true,
      get: () => hls,
      set: (value) => {
        hls = patchHls(value);
      },
    });
  } catch {
    // window.Hls can't be redefined here; nothing to speed up.
  }
})();

export {};
