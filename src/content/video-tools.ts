// Video tools, content-script side (every site, unless turned off): a small toolbar on each video, shown
// while the pointer is over it or it's paused. The page's main video (the biggest on screen) has it up from
// the start, and keeps a faint ⚡ in the corner while it plays.
//   ⚡ 1:20      how far ahead the video has loaded (parallel loading, video-boost.iife.ts)
//   720p ▾       quality menu, when the stream has more than one (just "720p" when it hasn't)
//   ⬇ Download   save the video as MP4 (video-download.ts)
//   EN subs      English over burned-in Chinese/Japanese subtitles (subs.ts)
//   CC ▾         subtitle files for the video, from SubtitleCat or this computer (cc-menu.ts)
//   « 1.00 »     playback speed: a step slower or faster; the number goes back to 1.00
//   PiP          picture-in-picture: the video in its own small window
// Player keys for the video being watched (space, arrows, J/K/L…, see VideoUi.key) come from the click
// shield too, which takes them before the site's own player or its ad scripts can.
// The toolbar sits in a layer that follows the video on screen (pointer-events: none except the buttons);
// when the player goes full screen, the layer moves into the full-screen element so it stays visible.
// Buttons get their clicks through the click shield (markUi/onUi), so the site's ad scripts never see them.
import { formatCode } from '../shared/codes';
import { shortDuration } from '../shared/range-fetch';
import { CcMenu, pageCode } from './cc-menu';
import { SubtitleReader, type StatusKind } from './subs';
import { button, markUi, onActivate } from './ui-events';
import { CancelledError, downloadFileName, VideoDownload, type DownloadProgress, type DownloadSource } from './video-download';

interface VideoInfo {
  manifestUrl: string;
  levelUrl: string;
  levels: { height: number; width: number; bitrate: number }[];
  currentLevel: number;
  auto: boolean;
  aheadSec: number;
  /** A player other than the page's hls.js (JW Player, say): its own menu switches quality. */
  playerQuality?: boolean;
}

/** Videos smaller than this (ads, previews) get no toolbar. */
const MIN_WIDTH = 240;
const MIN_HEIGHT = 135;
const HIDE_AFTER_MS = 2500;
const STATUS_MS = 5000;
/** Errors stay a little longer, to be read. */
const ERROR_MS = 12000;
/** How often to look for something else drawn where the toolbar sits, while it's shown. */
const OVERLAP_CHECK_MS = 600;
const GAP = 8;
/** A seek, speed or mute message: gone quickly, like a player's own. */
const FLASH_MS = 1400;
/** Speed: « and » (and the < and > keys) change it by this much, between these. */
const SPEED_STEP = 0.25;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
/** One frame, for , and . (the frame rate isn't known; most videos here are 30 a second). */
const FRAME_SEC = 1 / 30;

/** "1.00", "1.30" */
const speedName = (rate: number) => rate.toFixed(2);

/** "12:34", "1:02:10" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** Where the toolbar sits: px from the video's top and its left or right edge. */
interface Spot {
  side: 'left' | 'right';
  x: number;
  y: number;
}
const CORNER: Spot = { side: 'right', x: 10, y: 10 };

/**
 * What's drawn over the video at (x, y) besides the player itself and our layer: another extension's
 * controls (a speed controller, say) or the site's badges. Full-size layers (poster, click catcher) are
 * the player's own and don't count.
 */
function overlayAt(x: number, y: number, video: HTMLVideoElement, layer: HTMLElement, vr: DOMRect): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === video || el.contains(video)) return null; // down to the video or its player: nothing on top
    if (layer.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= vr.width * 0.6 && r.height >= vr.height * 0.6) continue;
    return el;
  }
  return null;
}

/** Everything overlayAt finds inside `box`, as one box, or null when the box is free. */
function overlaysIn(box: DOMRect, video: HTMLVideoElement, layer: HTMLElement, vr: DOMRect): DOMRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const y of [box.top + 6, box.bottom - 6]) {
    for (let x = box.left + 4; x <= box.right - 4; x += 12) {
      const el = overlayAt(x, y, video, layer, vr);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // A zero-size host (its controls drawn outside it, or in a shadow root): the point, widened by the
      // sampling step so the box doesn't come out smaller than what's there.
      const hit = r.width && r.height ? r : new DOMRect(x - 12, y - 6, 24, 12);
      left = Math.min(left, hit.left);
      top = Math.min(top, hit.top);
      right = Math.max(right, hit.right);
      bottom = Math.max(bottom, hit.bottom);
    }
  }
  return left === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
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

/** " · 850 KB/s", " · 1.4 MB/s" */
function speedText(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return '';
  return bytesPerSec >= 1e6 ? ` · ${(bytesPerSec / 1e6).toFixed(1)} MB/s` : ` · ${Math.round(bytesPerSec / 1e3)} KB/s`;
}

/** Tells the page's faster loading (video-boost.iife.ts) a download started or ended in this frame. */
function signalDownload(state: 'start' | 'end') {
  window.dispatchEvent(new CustomEvent('javtr:downloading', { detail: state }));
}

function levelName(level: VideoInfo['levels'][number]): string {
  if (level.height) return `${level.height}p`;
  return level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : '?';
}

/** The page's video code (PMX-046.mp4), else its title. In an embedded player, the page's around it. */
async function suggestedFileName(): Promise<string> {
  const { code, title } = await pageCode();
  return downloadFileName(code ? formatCode(code) : null, title.split(/\s[|–—-]\s/)[0]);
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
  private readonly ccBtn = button('javtr-cc-btn', 'CC ▾', 'Subtitle files for this video (SubtitleCat, or one on this computer)');
  private readonly slowerBtn = button('javtr-speed-step', '«', 'Slower (< key)');
  private readonly speedBtn = button('javtr-speed-btn', '1.00', '');
  private readonly fasterBtn = button('javtr-speed-step', '»', 'Faster (> key)');
  /** The speed it was at before the number put it back to 1.00: clicking the number again returns to it. */
  private lastSpeed = 0;
  private readonly pipBtn = button('javtr-pip-btn', 'PiP', 'Picture-in-picture: the video in its own small window (P key)');
  private readonly status = document.createElement('div');
  /** The pointer is on the video now. */
  private pointerOver = false;
  /** It has played with sound, or a key was used on it: the video being watched (see key). */
  private watched = false;
  private info: VideoInfo | null = null;
  private download: VideoDownload | null = null;
  private subs: SubtitleReader | null = null;
  private readonly cc: CcMenu;
  /** Whose menu is open, quality or CC (they share one). */
  private menuOwner: 'quality' | 'cc' | null = null;
  private hoverUntil = 0;
  private statusUntil = 0;
  private lastPlace = '';
  private spot: Spot = CORNER;
  private shown = false;
  private overlapCheckAt = 0;
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
    this.ccBtn.setAttribute('aria-pressed', 'false');
    this.menu.className = 'javtr-video-menu';
    this.menu.hidden = true;
    this.status.className = 'javtr-video-status';
    this.status.hidden = true;
    this.pipBtn.setAttribute('aria-pressed', 'false');
    this.pipBtn.hidden = !document.pictureInPictureEnabled || video.disablePictureInPicture;
    this.bar.append(this.ahead, this.quality, this.downloadBtn, this.cancelBtn, this.subsBtn, this.ccBtn, this.slowerBtn, this.speedBtn, this.fasterBtn, this.pipBtn, this.menu);
    this.layer.append(this.bar, this.status);
    document.documentElement.append(this.layer);
    this.cc = new CcMenu(video, this.layer, this.menu, (text, kind) => this.say(text, kind), (on) => {
      this.ccBtn.setAttribute('aria-pressed', String(on));
      this.ccBtn.classList.toggle('javtr-on', on);
      if (on && this.subs) {
        // One English line at a time: the file's replaces EN subs.
        this.subs.stop();
        this.setSubs(null);
      }
    });

    onActivate(this.quality, () => this.toggleMenu());
    onActivate(this.downloadBtn, () => this.startDownload());
    onActivate(this.cancelBtn, () => this.download?.cancel());
    onActivate(this.subsBtn, () => this.toggleSubs());
    onActivate(this.ccBtn, () => this.toggleCcMenu());
    onActivate(this.slowerBtn, () => this.stepSpeed(-1));
    onActivate(this.speedBtn, () => this.resetSpeed());
    onActivate(this.fasterBtn, () => this.stepSpeed(1));
    onActivate(this.pipBtn, () => this.togglePip());
    video.addEventListener('javtr:video-info', this.onInfo);
    for (const type of VideoUi.STATE_EVENTS) video.addEventListener(type, this.onState);
    this.onState();
  }

  private static readonly STATE_EVENTS = ['ratechange', 'playing', 'volumechange', 'emptied', 'enterpictureinpicture', 'leavepictureinpicture'];

  /** The video's speed, sound or window changed: the buttons say so. */
  private readonly onState = (e?: Event) => {
    const video = this.video;
    if (e?.type === 'emptied') this.watched = false; // another video in the same player
    if (!video.paused && !video.muted) this.watched = true;
    const rate = video.playbackRate;
    const normal = Math.abs(rate - 1) < 0.001;
    this.speedBtn.textContent = speedName(rate);
    this.speedBtn.classList.toggle('javtr-changed', !normal);
    this.speedBtn.title = normal
      ? this.lastSpeed
        ? `Playback speed. Click for ${speedName(this.lastSpeed)} again`
        : 'Playback speed. « and » change it'
      : 'Playback speed. Click to go back to 1.00';
    const inPip = document.pictureInPictureElement === video;
    this.pipBtn.setAttribute('aria-pressed', String(inPip));
    this.pipBtn.classList.toggle('javtr-on', inPip);
  };

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
    for (const type of VideoUi.STATE_EVENTS) this.video.removeEventListener(type, this.onState);
    this.download?.cancel();
    this.subs?.stop();
    this.cc.turnOff();
    this.layer.remove();
    window.removeEventListener('beforeunload', this.warnBeforeLeaving);
  }

  pointerAt(x: number, y: number) {
    const r = this.video.getBoundingClientRect();
    this.pointerOver = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (this.pointerOver) {
      this.hoverUntil = Date.now() + HIDE_AFTER_MS;
      // Straight away, not on the next frame: a quick click must land on the button, not the video.
      if (!this.layer.hidden) this.bar.classList.add('javtr-show');
    }
  }

  closeMenuUnless(target: EventTarget | null) {
    const inside = (el: HTMLElement) => target instanceof Node && el.contains(target);
    const buttons = [this.quality, this.ccBtn];
    if (!this.menu.hidden && !inside(this.menu) && !buttons.some(inside)) this.closeMenu();
  }

  private closeMenu() {
    if (this.menuOwner === 'cc') this.cc.close();
    this.menu.hidden = true;
    this.menuOwner = null;
  }

  /** Every frame: follow the video on screen, show or hide the toolbar. `main`: the page's main video. */
  frame(now: number, main: boolean) {
    if (this.subs?.stopped) this.setSubs(null);
    const video = this.video;
    const r = video.getBoundingClientRect();
    const fs = document.fullscreenElement;
    const parent = fs && fs !== video && fs.contains(video) ? fs : document.documentElement;
    const visible = video.isConnected && r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT && (!fs || parent === fs);
    if (this.layer.parentElement !== parent) parent.append(this.layer);
    this.layer.hidden = !visible;
    if (!visible) {
      this.shown = false;
      return;
    }

    const place = `${r.left},${r.top},${r.width},${r.height}`;
    if (place !== this.lastPlace) {
      this.lastPlace = place;
      Object.assign(this.layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      this.subs?.place();
      this.cc.file?.place();
    }
    this.cc.file?.update();
    // Like the player's own controls: shown while the pointer is over the video and while it's paused.
    // The main video has it from the start, before it's played; others (a page full of previews) once
    // they've played. While the main video plays, the ⚡ stays, faint, so the tools are seen to be there.
    const paused = video.paused && (main || video.played.length > 0);
    const show = now < this.hoverUntil || paused || !this.menu.hidden || this.busy;
    this.bar.classList.toggle('javtr-show', show);
    this.bar.classList.toggle('javtr-peek', !show && main);
    if (show && (!this.shown || now >= this.overlapCheckAt)) {
      this.overlapCheckAt = now + OVERLAP_CHECK_MS;
      this.avoidOverlays(r);
    }
    this.shown = show;
    // A message shows for its few seconds (an error a little longer), longer while the pointer is over
    // the video, and then it's gone (not back each time the toolbar shows, which while paused is all the
    // time). A wait ("Setting up translation…") stays until the next message.
    if (this.status.textContent && now > this.statusUntil && now >= this.hoverUntil) this.status.textContent = '';
    this.status.hidden = !this.status.textContent;
  }

  /**
   * Keeps the toolbar clear of other things drawn over the video (another extension's speed control
   * in the same corner, say): beside them, else the other top corner, else below them. It stays where
   * it was moved to while that spot is free, so it doesn't jump about as they show and hide.
   */
  private avoidOverlays(vr: DOMRect) {
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    if (!w || !h) return;
    const box = (s: Spot) => new DOMRect(s.side === 'right' ? vr.right - s.x - w : vr.left + s.x, vr.top + s.y, w, h);
    const fits = (b: DOMRect) => b.left >= vr.left + 4 && b.right <= vr.right - 4 && b.bottom <= vr.bottom - 4;
    const free = (s: Spot) => fits(box(s)) && !overlaysIn(box(s), this.video, this.layer, vr);
    if (free(this.spot)) return;
    const blocker = overlaysIn(box(CORNER), this.video, this.layer, vr);
    const spots: Spot[] = [CORNER];
    if (blocker) {
      spots.push(
        { side: 'right', x: vr.right - blocker.left + GAP, y: CORNER.y }, // beside it
        { side: 'left', x: CORNER.x, y: CORNER.y }, // the other corner
        { side: 'right', x: CORNER.x, y: blocker.bottom - vr.top + GAP }, // below it
      );
    }
    this.moveBar(spots.find(free) ?? CORNER, h);
  }

  private moveBar(spot: Spot, barHeight: number) {
    this.spot = spot;
    const tops = [spot.y, spot.y + barHeight + GAP];
    [this.bar, this.status].forEach((el, i) => {
      el.style.top = `${tops[i]}px`;
      el.style.left = spot.side === 'left' ? `${spot.x}px` : 'auto';
      el.style.right = spot.side === 'right' ? `${spot.x}px` : 'auto';
    });
  }

  private say(text: string, kind: StatusKind = 'note') {
    this.status.textContent = text;
    this.statusUntil = kind === 'wait' ? Infinity : Date.now() + (kind === 'error' ? ERROR_MS : STATUS_MS);
  }

  /** A short message that goes by itself, for a key press. */
  private flash(text: string) {
    this.status.textContent = text;
    this.statusUntil = Date.now() + FLASH_MS;
  }

  /**
   * A player key (from the click shield). True if it was this video's to take: it's the one being watched
   * (it has played with sound), the pointer is on it, or it's full screen. Otherwise the key stays the
   * page's, so J and K still move through a feed whose previews play muted, and space still scrolls.
   *   space, K   play / pause          ←, →   5 seconds          J, L   10 seconds
   *   , and .    one frame (pauses)    <, >   slower / faster    M      mute       P   picture-in-picture
   */
  key(key: string, repeat: boolean): boolean {
    const video = this.video;
    const fs = document.fullscreenElement;
    if (!this.watched && !this.pointerOver && !(fs && fs.contains(video))) return false;
    this.watched = true;
    switch (key) {
      case ' ':
      case 'k':
        if (repeat) break;
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
        break;
      case 'ArrowLeft':
        this.seek(-5);
        break;
      case 'ArrowRight':
        this.seek(5);
        break;
      case 'j':
        this.seek(-10);
        break;
      case 'l':
        this.seek(10);
        break;
      case ',':
      case '.':
        video.pause();
        this.seekTo(video.currentTime + (key === '.' ? FRAME_SEC : -FRAME_SEC));
        this.flash(`${key === '.' ? 'Next' : 'Previous'} frame`);
        break;
      case '<':
      case '>':
        this.stepSpeed(key === '>' ? 1 : -1);
        break;
      case 'm':
        if (repeat) break;
        video.muted = !video.muted;
        this.flash(video.muted ? 'Muted' : 'Sound on');
        break;
      case 'p':
        if (!repeat) this.togglePip();
        break;
      default:
        return false;
    }
    return true;
  }

  private seekTo(time: number) {
    const video = this.video;
    const end = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(Math.max(0, time), end);
  }

  private seek(by: number) {
    this.seekTo(this.video.currentTime + by);
    const { currentTime, duration } = this.video;
    const of = Number.isFinite(duration) ? ` / ${clock(duration)}` : '';
    this.flash(`${by > 0 ? '+' : '−'}${Math.abs(by)} s · ${clock(currentTime)}${of}`);
  }

  private setSpeed(rate: number) {
    this.video.playbackRate = rate;
    this.onState(); // the button says it now, not when the video reports the change
    this.flash(`Speed: ${speedName(rate)}×`);
  }

  /** « and »: a step slower or faster, from wherever the site's own menu left it. */
  private stepSpeed(direction: 1 | -1) {
    const next = Math.round((this.video.playbackRate + direction * SPEED_STEP) * 100) / 100;
    this.setSpeed(Math.min(MAX_SPEED, Math.max(MIN_SPEED, next)));
  }

  /** The number between them: back to normal speed, or from normal back to the speed it was at. */
  private resetSpeed() {
    const rate = this.video.playbackRate;
    if (Math.abs(rate - 1) > 0.001) {
      this.lastSpeed = rate;
      this.setSpeed(1);
    } else if (this.lastSpeed) {
      this.setSpeed(this.lastSpeed);
    } else {
      this.flash('Speed: 1.00×');
    }
  }

  private togglePip() {
    const video = this.video;
    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) {
      this.say('This player doesn’t allow picture-in-picture.');
      return;
    }
    const done = document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture();
    done.catch((err: unknown) => {
      // Before the video has loaded, or in an embedded player whose page doesn't allow it.
      const notReady = err instanceof DOMException && err.name === 'InvalidStateError';
      this.say(notReady ? 'Play the video for a moment, then try picture-in-picture again.' : 'This player doesn’t allow picture-in-picture.', 'error');
    });
  }

  private renderInfo() {
    const info = this.info;
    if (!info) return;
    this.ahead.hidden = false;
    this.ahead.textContent = `⚡ ${shortDuration(info.aheadSec)}`;
    this.ahead.title = 'Loaded ahead (faster loading is on)';
    if (info.playerQuality) {
      const height = this.video.videoHeight;
      this.quality.hidden = !height;
      this.quality.textContent = `${height}p`;
      this.quality.title = 'Playing quality (change it in the player’s own settings)';
      return;
    }
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
      const mine = this.menuOwner === 'quality';
      this.closeMenu();
      if (mine) return;
    }
    const info = this.info;
    if (!info) return;
    if (info.playerQuality) {
      this.say(`Playing ${this.quality.textContent}. Change the quality in the player’s own settings (⚙). Faster loading (⚡) is on.`);
      return;
    }
    if (info.levels.length < 2) {
      this.say(`This site only offers ${this.quality.textContent}. Faster loading (⚡) is on instead.`);
      return;
    }
    const item =(label: string, level: number, current: boolean) => {
      const b = button('javtr-menu-item', `${current ? '✓ ' : ''}${label}`, '');
      onActivate(b, () => {
        this.video.dispatchEvent(new CustomEvent('javtr:set-level', { detail: String(level) }));
        this.closeMenu();
        this.say(level < 0 ? 'Quality: automatic' : `Quality: ${label}`);
      });
      return b;
    };
    const sorted = info.levels.map((level, index) => ({ level, index })).sort((a, b) => b.level.height - a.level.height || b.level.bitrate - a.level.bitrate);
    this.menu.classList.remove('javtr-cc-menu');
    this.menu.style.maxHeight = '';
    this.menu.replaceChildren(
      item('Auto', -1, info.auto),
      ...sorted.map(({ level, index }) => item(levelName(level), index, !info.auto && index === info.currentLevel)),
    );
    this.menu.hidden = false;
    this.menuOwner = 'quality';
  }

  private toggleCcMenu() {
    if (!this.menu.hidden) {
      const mine = this.menuOwner === 'cc';
      this.closeMenu();
      if (mine) return;
    }
    this.status.textContent = ''; // it would sit under the menu
    this.cc.open();
    this.menuOwner = 'cc';
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
    // Only while it's this toolbar's download: a late report must not start the counting again.
    const download: VideoDownload = new VideoDownload(source, suggestedFileName(), (p) => this.download === download && this.showProgress(p));
    this.download = download;
    this.downloadBtn.textContent = '⬇ Choose where to save…';
    // Runs straight away: its first step is the "Save as" dialog, which needs this click.
    download
      .run()
      .then(
        (name) => this.say(`Saved ${name}`),
        (err: unknown) => {
          if (err instanceof CancelledError) this.say('Download cancelled.');
          else this.say(`Download failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        },
      )
      .finally(() => {
        if (!this.cancelBtn.hidden) signalDownload('end');
        this.download = null;
        this.downloadBtn.textContent = '⬇ Download';
        this.downloadBtn.title = 'Save this video as an MP4 file';
        this.cancelBtn.hidden = true;
        window.removeEventListener('beforeunload', this.warnBeforeLeaving);
      });
  }

  private showProgress(p: DownloadProgress) {
    if (this.cancelBtn.hidden) {
      // The first progress: past the "Save as" dialog, downloading.
      this.cancelBtn.hidden = false;
      window.addEventListener('beforeunload', this.warnBeforeLeaving); // closing the tab stops it
      signalDownload('start');
      this.say(
        this.video.paused
          ? 'Downloading. Keep this tab open until it finishes.'
          : 'Downloading. Keep this tab open until it finishes. Pausing the video can make it faster.',
      );
    }
    this.downloadBtn.textContent = `⬇ ${Math.floor(p.fraction * 100)}%${speedText(p.speed)}${eta(p.etaSec)}`;
    const parallel = p.parallel ? `, ${p.parallel} requests at once` : '';
    this.downloadBtn.title = `${megabytes(p.bytes)} downloaded${parallel}. Keep this tab open until it finishes.`;
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
    this.cc.turnOff(); // one English line at a time: EN subs replaces a subtitle file
    const reader = new SubtitleReader(this.video, this.layer, (text, kind) => this.say(text, kind));
    this.setSubs(reader);
    // Started from this click: Chrome's first translator download needs it.
    reader.start().catch((err: unknown) => {
      reader.stop();
      this.say(err instanceof Error ? err.message : String(err), 'error');
    });
  }
}

// --- Finding videos ---
const uis = new Map<HTMLVideoElement, VideoUi>();
let observer: MutationObserver | null = null;
let raf = 0;
/** The page's main video as of the last frame: the one player keys are for. */
let current: HTMLVideoElement | null = null;

const onPlayerKey = (e: Event) => {
  const { key, repeat } = (e as CustomEvent<{ key?: unknown; repeat?: unknown } | null>).detail ?? {};
  const ui = current && uis.get(current);
  // Cancelling it tells the shield the key was taken, so the page never sees it.
  if (ui && typeof key === 'string' && ui.key(key, repeat === true)) e.preventDefault();
};

function attach(video: HTMLVideoElement) {
  if (!uis.has(video)) uis.set(video, new VideoUi(video));
}

function scan(root: ParentNode) {
  if (root instanceof HTMLVideoElement) attach(root);
  root.querySelectorAll?.('video').forEach(attach);
}

/** The page's main video: the one with the most of it on screen (big enough for a toolbar). */
function mainVideo(): HTMLVideoElement | null {
  let main: HTMLVideoElement | null = null;
  let most = 0;
  for (const video of uis.keys()) {
    const r = video.getBoundingClientRect();
    if (r.width < MIN_WIDTH || r.height < MIN_HEIGHT) continue;
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (w > 0 && h > 0 && w * h > most) {
      most = w * h;
      main = video;
    }
  }
  return main;
}

function loop() {
  const now = Date.now();
  for (const [video, ui] of uis) {
    if (!video.isConnected && !ui.busy) {
      ui.destroy();
      uis.delete(video);
    }
  }
  current = mainVideo();
  for (const [video, ui] of uis) ui.frame(now, video === current);
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
  window.addEventListener('javtr:player-key', onPlayerKey);
  raf = requestAnimationFrame(loop);
}

export function disableVideoTools() {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('pointermove', onPointerMove, { capture: true });
  window.removeEventListener('pointerdown', onPointerDown, { capture: true });
  window.removeEventListener('javtr:player-key', onPlayerKey);
  current = null;
  cancelAnimationFrame(raf);
  for (const ui of uis.values()) ui.destroy();
  uis.clear();
}
