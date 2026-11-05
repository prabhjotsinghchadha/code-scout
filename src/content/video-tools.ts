// Video tools, content-script side (on sites where "Video tools" is on): a small toolbar on each video,
// shown while it's paused or the pointer is over it.
//   ⚡ 1:20      how far ahead the video has loaded (parallel loading, video-boost.iife.ts)
//   720p ▾       quality menu, when the stream has more than one (just "720p" when it hasn't)
//   ⬇ Download   save the video as MP4 (video-download.ts)
//   EN subs      English over burned-in Chinese/Japanese subtitles (subs.ts)
// The toolbar sits in a layer that follows the video on screen (pointer-events: none except the buttons);
// when the player goes full screen, the layer moves into the full-screen element so it stays visible.
// Buttons get their clicks through the click shield (markUi/onUi), so the site's ad scripts never see them.
import { formatCode, parseCode } from '../shared/codes';
import { shortDuration } from '../shared/range-fetch';
import { SubtitleReader } from './subs';
import { markUi, onUi } from './ui-events';
import { CancelledError, downloadFileName, VideoDownload, type DownloadProgress, type DownloadSource } from './video-download';

interface VideoInfo {
  manifestUrl: string;
  levelUrl: string;
  levels: { height: number; width: number; bitrate: number }[];
  currentLevel: number;
  auto: boolean;
  aheadSec: number;
}

/** Videos smaller than this (ads, previews) get no toolbar. */
const MIN_WIDTH = 240;
const MIN_HEIGHT = 135;
const HIDE_AFTER_MS = 2500;
const STATUS_MS = 5000;

function button(className: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.title = title;
  return b;
}

/** Click or Enter/Space (the shield cancels the key's default, so no click follows it). */
function onActivate(el: HTMLElement, action: () => void) {
  onUi(el, 'click', ({ button }) => button === 0 && action());
  onUi(el, 'keydown', ({ key }) => (key === 'Enter' || key === ' ') && action());
}

function eta(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return ' · <1 min left';
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? ` · ${minutes} min left` : ` · ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

function megabytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function levelName(level: VideoInfo['levels'][number]): string {
  if (level.height) return `${level.height}p`;
  return level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : '?';
}

/** The page's video code (PMX-046.mp4), else its title. */
function suggestedFileName(): string {
  const code = parseCode(decodeURIComponent(location.pathname)) ?? parseCode(document.title);
  const title = document.title.split(/\s[|–—-]\s/)[0];
  return downloadFileName(code ? formatCode(code) : null, title);
}

class VideoUi {
  readonly video: HTMLVideoElement;
  private readonly layer = markUi(document.createElement('div'));
  private readonly bar = document.createElement('div');
  private readonly ahead = document.createElement('span');
  private readonly quality = button('javtr-quality', 'Quality ▾', 'Video quality');
  private readonly menu = document.createElement('div');
  private readonly downloadBtn = button('javtr-download', '⬇ Download', 'Save this video as an MP4 file');
  private readonly cancelBtn = button('javtr-cancel', '✕', 'Cancel the download');
  private readonly subsBtn = button('javtr-subs-btn', 'EN subs', 'Cover Chinese/Japanese subtitles with English');
  private readonly status = document.createElement('div');
  private info: VideoInfo | null = null;
  private download: VideoDownload | null = null;
  private subs: SubtitleReader | null = null;
  private hoverUntil = 0;
  private statusUntil = 0;
  private lastPlace = '';
  private readonly warnBeforeLeaving = (e: BeforeUnloadEvent) => e.preventDefault();

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.layer.className = 'javtr-video-layer';
    this.layer.hidden = true;
    this.bar.className = 'javtr-video-bar';
    this.ahead.className = 'javtr-ahead';
    this.ahead.hidden = true;
    this.quality.hidden = true;
    this.cancelBtn.hidden = true;
    this.subsBtn.setAttribute('aria-pressed', 'false');
    this.menu.className = 'javtr-video-menu';
    this.menu.hidden = true;
    this.status.className = 'javtr-video-status';
    this.status.hidden = true;
    this.bar.append(this.ahead, this.quality, this.downloadBtn, this.cancelBtn, this.subsBtn, this.menu);
    this.layer.append(this.bar, this.status);
    document.documentElement.append(this.layer);

    onActivate(this.quality, () => this.toggleMenu());
    onActivate(this.downloadBtn, () => this.startDownload());
    onActivate(this.cancelBtn, () => this.download?.cancel());
    onActivate(this.subsBtn, () => this.toggleSubs());
    video.addEventListener('javtr:video-info', this.onInfo);
  }

  private readonly onInfo = (e: Event) => {
    try {
      this.info = JSON.parse(String((e as CustomEvent).detail)) as VideoInfo;
    } catch {
      return;
    }
    this.renderInfo();
  };

  get busy() {
    return !!this.download;
  }

  destroy() {
    this.video.removeEventListener('javtr:video-info', this.onInfo);
    this.download?.cancel();
    this.subs?.stop();
    this.layer.remove();
    window.removeEventListener('beforeunload', this.warnBeforeLeaving);
  }

  pointerAt(x: number, y: number) {
    const r = this.video.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      this.hoverUntil = Date.now() + HIDE_AFTER_MS;
      // Straight away, not on the next frame: a quick click must land on the button, not the video.
      if (!this.layer.hidden) this.bar.classList.add('javtr-show');
    }
  }

  closeMenuUnless(target: EventTarget | null) {
    if (!this.menu.hidden && !(target instanceof Node && (this.menu.contains(target) || this.quality.contains(target)))) {
      this.menu.hidden = true;
    }
  }

  /** Every frame: follow the video on screen, show or hide the toolbar. */
  frame(now: number) {
    if (this.subs?.stopped) this.setSubs(null);
    const video = this.video;
    const r = video.getBoundingClientRect();
    const fs = document.fullscreenElement;
    const parent = fs && fs !== video && fs.contains(video) ? fs : document.documentElement;
    const visible = video.isConnected && r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT && (!fs || parent === fs);
    if (this.layer.parentElement !== parent) parent.append(this.layer);
    this.layer.hidden = !visible;
    if (!visible) return;

    const place = `${r.left},${r.top},${r.width},${r.height}`;
    if (place !== this.lastPlace) {
      this.lastPlace = place;
      Object.assign(this.layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      this.subs?.place();
    }
    // Like the player's own controls: shown while paused, and while the pointer is over the video.
    const show = now < this.hoverUntil || video.paused || !this.menu.hidden || this.busy;
    this.bar.classList.toggle('javtr-show', show);
    this.status.hidden = !this.status.textContent || (now > this.statusUntil && !show);
  }

  private say(text: string, sticky = false) {
    this.status.textContent = text;
    this.statusUntil = sticky ? Infinity : Date.now() + STATUS_MS;
  }

  private renderInfo() {
    const info = this.info;
    if (!info) return;
    this.ahead.hidden = false;
    this.ahead.textContent = `⚡ ${shortDuration(info.aheadSec)}`;
    this.ahead.title = 'Loaded ahead (faster loading is on)';
    const levels = info.levels;
    if (levels.length < 2) {
      // One quality only (18JAV serves just 720p): say so, rather than leaving people looking for a menu.
      const height = levels[0]?.height || this.video.videoHeight;
      this.quality.hidden = !height;
      this.quality.textContent = `${height}p`;
      this.quality.title = 'The only quality this site offers';
      return;
    }
    this.quality.hidden = false;
    this.quality.title = 'Video quality';
    const playing = levels[info.currentLevel];
    const name = playing ? levelName(playing) : 'Quality';
    this.quality.textContent = `${info.auto ? `Auto · ${name}` : name} ▾`;
  }

  private toggleMenu() {
    if (!this.menu.hidden) {
      this.menu.hidden = true;
      return;
    }
    const info = this.info;
    if (!info) return;
    if (info.levels.length < 2) {
      this.say(`This site only offers ${this.quality.textContent}. Faster loading (⚡) is on instead.`);
      return;
    }
    const item =(label: string, level: number, current: boolean) => {
      const b = button('javtr-menu-item', `${current ? '✓ ' : ''}${label}`, '');
      onActivate(b, () => {
        this.video.dispatchEvent(new CustomEvent('javtr:set-level', { detail: String(level) }));
        this.menu.hidden = true;
        this.say(level < 0 ? 'Quality: automatic' : `Quality: ${label}`);
      });
      return b;
    };
    const sorted = info.levels.map((level, index) => ({ level, index })).sort((a, b) => b.level.height - a.level.height || b.level.bitrate - a.level.bitrate);
    this.menu.replaceChildren(
      item('Auto', -1, info.auto),
      ...sorted.map(({ level, index }) => item(levelName(level), index, !info.auto && index === info.currentLevel)),
    );
    this.menu.hidden = false;
  }

  private source(): DownloadSource | null {
    // Several qualities: the one picked in the menu, else (Auto, which may have dropped on a slow
    // connection) the best one.
    const info = this.info;
    if (info?.manifestUrl) return { playlistUrl: info.manifestUrl, playingUrl: (!info.auto && info.levelUrl) || undefined };
    const src = this.video.currentSrc;
    if (/^https?:/i.test(src)) return /\.m3u8(\?|#|$)/i.test(src) ? { playlistUrl: src } : { fileUrl: src };
    // A player other than hls.js: the newest playlist the page loaded.
    const playlist = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((name) => /\.m3u8(\?|#|$)/i.test(name))
      .pop();
    return playlist ? { playlistUrl: playlist } : null;
  }

  private startDownload() {
    if (this.download) return;
    const source = this.source();
    if (!source) {
      this.say('Couldn’t find the video file. Play the video for a moment, then try again.');
      return;
    }
    const name = suggestedFileName();
    const download = new VideoDownload(source, name, (p) => this.showProgress(p));
    this.download = download;
    this.downloadBtn.textContent = '⬇ Choose where to save…';
    // Runs straight away: its first step is the "Save as" dialog, which needs this click.
    download
      .run()
      .then(
        () => this.say(`Saved ${name}`, false),
        (err: unknown) => {
          if (err instanceof CancelledError) this.say('Download cancelled.');
          else this.say(`Download failed: ${err instanceof Error ? err.message : String(err)}`, true);
        },
      )
      .finally(() => {
        this.download = null;
        this.downloadBtn.textContent = '⬇ Download';
        this.downloadBtn.title = 'Save this video as an MP4 file';
        this.cancelBtn.hidden = true;
        window.removeEventListener('beforeunload', this.warnBeforeLeaving);
      });
  }

  private showProgress(p: DownloadProgress) {
    if (this.cancelBtn.hidden) {
      this.cancelBtn.hidden = false;
      window.addEventListener('beforeunload', this.warnBeforeLeaving); // closing the tab stops it
      this.say('Downloading. Keep this tab open until it finishes.');
    }
    this.downloadBtn.textContent = `⬇ ${Math.floor(p.fraction * 100)}%${eta(p.etaSec)}`;
    this.downloadBtn.title = `${megabytes(p.bytes)} downloaded. Keep this tab open until it finishes.`;
  }

  private setSubs(reader: SubtitleReader | null) {
    this.subs = reader;
    this.subsBtn.setAttribute('aria-pressed', String(!!reader));
    this.subsBtn.classList.toggle('javtr-on', !!reader);
  }

  private toggleSubs() {
    if (this.subs) {
      this.subs.stop();
      this.setSubs(null);
      this.say('EN subs off.');
      return;
    }
    const reader = new SubtitleReader(this.video, this.layer, (text, sticky) => this.say(text, sticky));
    this.setSubs(reader);
    // Started from this click: Chrome's first translator download needs it.
    reader.start().catch((err: unknown) => {
      reader.stop();
      this.say(err instanceof Error ? err.message : String(err), true);
    });
  }
}

// --- Finding videos ---
const uis = new Map<HTMLVideoElement, VideoUi>();
let observer: MutationObserver | null = null;
let raf = 0;

function attach(video: HTMLVideoElement) {
  if (!uis.has(video)) uis.set(video, new VideoUi(video));
}

function scan(root: ParentNode) {
  if (root instanceof HTMLVideoElement) attach(root);
  root.querySelectorAll?.('video').forEach(attach);
}

function loop() {
  const now = Date.now();
  for (const [video, ui] of uis) {
    if (!video.isConnected && !ui.busy) {
      ui.destroy();
      uis.delete(video);
      continue;
    }
    ui.frame(now);
  }
  raf = requestAnimationFrame(loop);
}

const onPointerMove = (e: PointerEvent) => {
  for (const ui of uis.values()) ui.pointerAt(e.clientX, e.clientY);
};
const onPointerDown = (e: PointerEvent) => {
  for (const ui of uis.values()) ui.closeMenuUnless(e.composedPath()[0] ?? null);
};

export function enableVideoTools() {
  if (observer) return;
  scan(document);
  observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) scan(node);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  raf = requestAnimationFrame(loop);
}

export function disableVideoTools() {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('pointermove', onPointerMove, { capture: true });
  window.removeEventListener('pointerdown', onPointerDown, { capture: true });
  cancelAnimationFrame(raf);
  for (const ui of uis.values()) ui.destroy();
  uis.clear();
}
