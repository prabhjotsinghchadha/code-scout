// Video tools, page side: faster loading for HLS players, and the quality menu for hls.js ones.
// Runs in the page's own JavaScript world at document_start, in every frame of sites where "Video tools"
// is on (the background registers it with chrome.scripting). A player embedded on a page where they're
// turned off gets "javtr:video-off" from the content script, and loads normally from then on.
//
// Some video servers send each request slowly (18JAV's CDN: about 50 KB/s per request, while the video
// needs about 250 KB/s) but let several requests run at once. So each segment is downloaded as parallel
// byte ranges, with the next segments fetched ahead, and handed to the player from memory:
//  - hls.js on the page (window.Hls): it gets a loader that hands it the bytes through a blob: URL, which
//    its own loader reads instantly.
//  - Any other player (hls.js bundled inside it, JW Player, Video.js, Shaka): the same at the network
//    level. Playlists the page downloads (XMLHttpRequest or fetch) are remembered, and when the player
//    then asks for one of their segments, the request is answered with the bytes fetched ahead.
// Only finished videos (not live streams). Anything unusual (byte-range segments, a failed range
// request) falls back to the player's normal loading. While a download runs in the frame
// (video-download.ts sends "javtr:downloading"), only a few segments are fetched ahead, leaving the
// video server's connections to the download.
//
// It also reports each player's state (qualities, how far ahead it has loaded, the playlist URL for
// downloads) to the content script with a "javtr:video-info" event on the <video>, and switches hls.js's
// quality on "javtr:set-level" (other players keep their own quality menu). No chrome.* APIs here.
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
  // Untouched copies: our own range requests mustn't go through the wrappers below.
  const nativeFetch = window.fetch;
  const fetchNative: typeof fetch = (input, init) => nativeFetch.call(window, input, init);

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
  /** When the player last asked for a segment of each playlist, and which one. */
  const lastAsked = new Map<string[], number>();
  const lastIndex = new Map<string[], number>();
  const players = new Map<HTMLMediaElement, Loose>();
  /** Playlist each segment list came from, and the last master playlist seen (for downloads). */
  const listUrls = new Map<string[], string>();
  let lastMaster = '';
  /** Players served at the network level: the list they're playing, for the toolbar. */
  let generic: { list: string[] } | null = null;
  /** Segments to load the player's way once (their fetch ahead failed). */
  const plainOnce = new Set<string>();

  const anyPlaying = () => [...players.keys(), ...document.getElementsByTagName('video')].some((m) => !m.paused);

  /** Downloads running in this frame: fetch only a little ahead meanwhile. */
  let downloads = 0;
  window.addEventListener('javtr:downloading', (e) => {
    downloads = Math.max(0, downloads + ((e as CustomEvent).detail === 'start' ? 1 : -1));
    if (!downloads) return;
    // Stop fetching what's further ahead than that (what's already here stays).
    for (const [url, job] of jobs) {
      const p = positions.get(url);
      if (!p || job.done || p.index <= (lastIndex.get(p.list) ?? -1) + AHEAD_PAUSED) continue;
      job.controller.abort();
      jobs.delete(url);
    }
  });

  let off = false;
  window.addEventListener('javtr:video-off', () => {
    off = true;
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  });

  function recordPlaylist(text: string, url: string) {
    if (!isPlaylist(text)) return;
    if (isMasterPlaylist(text)) {
      lastMaster = url;
      return;
    }
    const playlist = parseMediaPlaylist(text, url);
    if (playlist.byteRanges || !playlist.ended || !playlist.segments.length) return; // live: nothing to fetch ahead
    const list = playlist.segments;
    const known = positions.get(list[0]);
    if (known && known.list.length === list.length) return; // seen already (hls.js's loader and the wrapper both report it)
    listUrls.set(list, url);
    list.forEach((segment, index) => positions.set(segment, { list, durations: playlist.durations, index }));
  }

  function start(url: string, pos: Position, index: number) {
    if (jobs.has(url)) return;
    const controller = new AbortController();
    const job: Job = {
      controller,
      done: false,
      duration: pos.durations[index] ?? 0,
      promise: fetchInRanges(url, { limiter, priority: index, signal: controller.signal, parallel: 4, fetch: fetchNative }),
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
    lastIndex.set(pos.list, pos.index);
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
    const ahead = anyPlaying() && !downloads ? AHEAD_PLAYING : AHEAD_PAUSED;
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
                if (this.javtrToken !== token) return;
                plainOnce.add(context.url);
                super.load(context, config, callbacks);
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
    if (generic) {
      // Players served at the network level: their <video> (fed by MediaSource, so a blob: source).
      const media = listUrls.get(generic.list) ?? '';
      for (const video of document.getElementsByTagName('video')) {
        if (players.has(video) || !video.currentSrc.startsWith('blob:')) continue;
        const info = {
          manifestUrl: lastMaster || media,
          levelUrl: media,
          levels: [],
          currentLevel: -1,
          auto: false,
          aheadSec: bufferedAhead(video) + fetchedAhead,
          playerQuality: true, // the player's own menu switches quality
        };
        video.dispatchEvent(new CustomEvent('javtr:video-info', { detail: JSON.stringify(info) }));
      }
    }
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
    if (!players.size && !generic) {
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

  // --- Any other player: its requests ---
  const absolute = (url: unknown) => {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return '';
    }
  };
  const looksLikePlaylist = (text: string) => /^\uFEFF?\s*#EXTM3U/.test(text.slice(0, 64));

  /** The bytes for a segment the player asked for, or null to let its request go ahead as usual. */
  function serve(url: string): Promise<Uint8Array> | null {
    if (off || !url || !positions.has(url) || plainOnce.delete(url)) return null;
    let pending: Promise<Uint8Array> | null = null;
    try {
      pending = want(url);
    } catch {
      return null;
    }
    if (pending) {
      generic = { list: positions.get(url)!.list };
      reporting ??= setInterval(report, 1000);
    }
    return pending;
  }

  interface XhrState {
    url: string;
    method: string;
    async: boolean;
    range: boolean;
    aborted: boolean;
  }
  const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();
  const watched = new WeakSet<XMLHttpRequest>();
  const xhr = XMLHttpRequest.prototype;
  const nativeOpen = xhr.open;
  const nativeSend = xhr.send;
  const nativeSetHeader = xhr.setRequestHeader;
  const nativeAbort = xhr.abort;

  function notePlaylist(this: XMLHttpRequest) {
    if (this.readyState !== 4 || this.status < 200 || this.status >= 300) return;
    if (this.responseType !== '' && this.responseType !== 'text') return;
    try {
      const text = this.responseText;
      if (looksLikePlaylist(text)) recordPlaylist(text, this.responseURL || xhrStates.get(this)?.url || '');
    } catch {
      // Not readable, or not a playlist we understand.
    }
  }

  xhr.open = function (this: XMLHttpRequest, ...args: Loose[]) {
    // The same request object used again: forget what was set for the last one.
    if (Object.prototype.hasOwnProperty.call(this, 'responseURL')) delete (this as Loose).responseURL;
    // open(method, url) is async; with a third argument, that argument decides (undefined = not async).
    const async = args.length < 3 || !!args[2];
    xhrStates.set(this, { url: absolute(args[1]), method: String(args[0]).toUpperCase(), async, range: false, aborted: false });
    if (!watched.has(this)) {
      watched.add(this);
      this.addEventListener('readystatechange', notePlaylist); // before the player's own handler, usually
    }
    return (nativeOpen as Loose).apply(this, args);
  };

  xhr.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const state = xhrStates.get(this);
    if (state && /^range$/i.test(name)) state.range = true;
    return nativeSetHeader.call(this, name, value);
  };

  xhr.abort = function (this: XMLHttpRequest) {
    const state = xhrStates.get(this);
    if (state) state.aborted = true;
    return nativeAbort.call(this);
  };

  xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const state = xhrStates.get(this);
    const pending = state && state.async && state.method === 'GET' && !state.range ? serve(state.url) : null;
    if (!pending) return nativeSend.call(this, body);
    // Until the bytes are here the request looks sent but unanswered (readyState 1), as usual. Then it's
    // pointed at a blob: URL of them and really sent, so the player gets its normal events and response.
    pending.then(
      (bytes) => {
        if (state!.aborted) return;
        const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
        try {
          nativeOpen.call(this, 'GET', blobUrl, true);
          Object.defineProperty(this, 'responseURL', { configurable: true, get: () => state!.url });
          this.addEventListener('loadend', () => URL.revokeObjectURL(blobUrl), { once: true });
          nativeSend.call(this);
        } catch {
          URL.revokeObjectURL(blobUrl);
        }
      },
      () => {
        if (state!.aborted) return;
        try {
          nativeSend.call(this, body); // still opened for the original address
        } catch {
          // The player moved on meanwhile.
        }
      },
    );
  };

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url = '';
    try {
      const request = input instanceof Request ? input : null;
      url = absolute(request ? request.url : input);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      const ranged = new Headers(init?.headers ?? request?.headers).has('range');
      const pending = method === 'GET' && !ranged ? serve(url) : null;
      if (pending) {
        const signal = init?.signal ?? request?.signal;
        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (signal?.aborted) return onAbort();
          signal?.addEventListener('abort', onAbort, { once: true });
          pending
            .then(
              (bytes) => {
                const response = new Response(bytes as BodyInit, { status: 200, statusText: 'OK' });
                Object.defineProperty(response, 'url', { value: url });
                resolve(response);
              },
              () => resolve(fetchNative(input, init)),
            )
            .finally(() => signal?.removeEventListener('abort', onAbort));
        });
      }
    } catch {
      // Unusual arguments: leave them to the browser.
    }
    const result = fetchNative(input, init);
    // Playlists fetched by the player: read a copy.
    void result
      .then((response) => {
        const playlistType = /mpegurl/i.test(response.headers.get('content-type') ?? '') || /\.m3u8?(\?|#|$)/i.test(url);
        if (!response.ok || !playlistType) return;
        void response
          .clone()
          .text()
          .then((text) => looksLikePlaylist(text) && recordPlaylist(text, response.url || url))
          .catch(() => {});
      })
      .catch(() => {});
    return result;
  };

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
