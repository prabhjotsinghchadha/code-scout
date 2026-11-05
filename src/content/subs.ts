// Video tools: "EN subs". Reads the Chinese or Japanese subtitle burned into the video picture and
// covers it with an English box, all on this computer:
//  1. About every 0.4 s, the bottom of the current frame is drawn into a small canvas.
//  2. A quick check of the text-like pixels (white or yellow with a dark outline) tells whether there's
//     anything new to read. While an English line is shown, only the pixels inside its box are compared,
//     so a moving background doesn't cause re-reads; otherwise reads back off while scenes keep
//     turning out to have no subtitle. Only then is the strip sent to the OCR model (offscreen
//     document, via the background).
//  3. Lines that look like subtitles (centred, confident, not a watermark that never changes) are
//     translated with Chrome's on-device Translator and drawn over the original.
import { sendToBackground } from '../shared/messages';
import { defaultSettings, getSettings, onSettingsChanged, type Settings } from '../shared/storage';
import {
  hasKana,
  isEmptyMask,
  LruCache,
  maskCount,
  maskDensity,
  maskDifference,
  maskRegion,
  normalizeLine,
  pictureRect,
  preferOutlined,
  STRIP_FRACTION,
  STRIP_WIDTH,
  stripBoxToScreen,
  subtitleLookVars,
  subtitleLanguage,
  subtitleLines,
  textMask,
  unionBox,
  WatermarkTracker,
  type Box,
} from '../shared/subtitles';
import { createTranslators, translatorApi, type SubtitleLang, type TranslateFn } from '../shared/translator';

const TICK_MS = 250;
/** Once the original line has changed or gone, keep its English this much longer (it showed up late)… */
const LINGER_MS = 600;
/** …and on screen this long at least, so short lines can be read. A new line replaces it straight away. */
const MIN_SHOW_MS = 1500;
/** How different the strip's text pixels must be to be worth reading again. */
const NEW_LINE = 0.25;
/** How different the pixels inside a shown line's box must be to count as a new line. */
const LINE_CHANGED = 0.35;
/** Longest wait between reads while frames keep turning out to have no subtitle. */
const MAX_BACKOFF_MS = 1600;

/** Logs reads and timings to the console when the page's localStorage has "javtr-debug" set. */
function debug(...args: unknown[]) {
  try {
    if (localStorage.getItem('javtr-debug')) console.debug('[javtr subs]', ...args);
  } catch {
    // storage blocked on this site
  }
}

/** Translation in this page if Chrome offers it here, else through the offscreen document. */
async function prepareTranslation(onStatus: (text: string) => void): Promise<TranslateFn> {
  if (translatorApi()) return createTranslators(onStatus);
  const viaExtension: TranslateFn = async (text, from) => {
    const result = await sendToBackground({ type: 'TRANSLATE', text, from });
    if ('error' in result) throw new Error(result.error);
    return result.text;
  };
  await viaExtension('你好', 'zh'); // fails early with a clear message if translation isn't set up
  return viaExtension;
}

interface Shown {
  english: string;
  /** The original line(s), in strip pixels. */
  box: Box;
  stripHeight: number;
  /** Text pixels inside `box` when it was read, to notice when the line changes or goes. */
  region: Uint8Array;
  count: number;
  /** When it went up (performance.now()). */
  shownAt: number;
  /** When the original line changed or went, while waiting to read what's there now. */
  changedAt: number;
}

// The look from Settings (text size, background), shared by every reader and applied as it changes.
let look = { size: defaultSettings.subSize, background: defaultSettings.subBackground };
const readers = new Set<SubtitleReader>();
const applyLook = (settings: Settings) => {
  look = { size: settings.subSize, background: settings.subBackground };
  for (const reader of readers) reader.place();
};
void getSettings().then(applyLook);
onSettingsChanged(applyLook);

export class SubtitleReader {
  private readonly video: HTMLVideoElement;
  private readonly onStatus: (text: string, sticky?: boolean) => void;
  private readonly el: HTMLDivElement;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private timer: ReturnType<typeof setInterval> | undefined;
  private translate: TranslateFn | null = null;
  private busy = false;
  private lastTime = -1;
  /** Text pixels of the strip last read by OCR. */
  private lastRead: Uint8Array | null = null;
  private generation = 0;
  private japanese = false;
  private errors = 0;
  private backoff = TICK_MS;
  private nextRead = 0;
  private shown: Shown | null = null;
  private track: TextTrack | null = null;
  /** Turned off, by the user or after an error. */
  stopped = false;
  private readonly watermarks = new WatermarkTracker();
  private readonly cache = new LruCache<string, string>(500);
  private readonly onSeek = () => {
    this.generation++;
    this.lastRead = null;
    this.lastTime = -1;
    this.nextRead = 0;
    this.backoff = TICK_MS;
    this.watermarks.reset();
    this.hide();
  };

  constructor(video: HTMLVideoElement, layer: HTMLElement, onStatus: (text: string, sticky?: boolean) => void) {
    this.video = video;
    this.onStatus = onStatus;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.el = document.createElement('div');
    this.el.className = 'javtr-sub';
    this.el.hidden = true;
    layer.append(this.el);
  }

  /** Call from the click that turned it on (the translator's first download needs one). */
  async start() {
    this.onStatus('Setting up translation…', true);
    this.translate = await prepareTranslation((text) => this.onStatus(text, true));
    if (this.stopped) return; // turned off while setting up
    this.onStatus('Reading subtitles…');
    readers.add(this);
    this.video.addEventListener('seeking', this.onSeek);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop() {
    this.stopped = true;
    readers.delete(this);
    clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
    this.video.removeEventListener('seeking', this.onSeek);
    this.hide();
    this.el.remove();
    if (this.track) this.track.mode = 'disabled';
  }

  private async tick() {
    const video = this.video;
    if (this.busy || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === this.lastTime) return; // paused: this frame is already read
    this.lastTime = video.currentTime;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sourceHeight = Math.round(vh * STRIP_FRACTION);
    const width = STRIP_WIDTH;
    const height = Math.max(1, Math.round((sourceHeight * width) / vw));
    this.canvas.width = width;
    this.canvas.height = height;
    let pixels: ImageData;
    try {
      this.ctx.drawImage(video, 0, vh - sourceHeight, vw, sourceHeight, 0, 0, width, height);
      pixels = this.ctx.getImageData(0, 0, width, height);
    } catch {
      this.onStatus('This site doesn’t let the video picture be read, so subtitles can’t be translated here.', true);
      this.stop();
      return;
    }

    const mask = textMask(pixels.data, width, height);
    const now = performance.now();
    const shown = this.shown;
    if (shown) {
      const region = maskRegion(mask, width, shown.box);
      const stillThere = maskCount(region) >= shown.count * 0.4;
      if (stillThere && maskDifference(region, shown.region) < LINE_CHANGED) {
        shown.changedAt = 0; // same line (or it came back after a flicker)
        return;
      }
      // Changed or gone: read what's there now. The English stays until the next line's is ready, or
      // until it has been up long enough, so lines don't flash by.
      if (!shown.changedAt) {
        shown.changedAt = now;
        this.lastRead = null;
        this.nextRead = 0;
      }
      if (now - shown.changedAt >= LINGER_MS && now - shown.shownAt >= MIN_SHOW_MS) {
        debug('hide', video.currentTime.toFixed(1));
        this.hide();
      }
    }
    if (isEmptyMask(mask)) {
      this.lastRead = null;
      return;
    }
    if (this.lastRead && maskDifference(mask, this.lastRead) < NEW_LINE) return; // nothing new since the last read
    if (now < this.nextRead) return;

    this.busy = true;
    const generation = this.generation;
    try {
      const readAt = video.currentTime;
      const result = await sendToBackground({ type: 'OCR_STRIP', image: this.canvas.toDataURL('image/jpeg', 0.85) });
      if (generation !== this.generation) return;
      if ('error' in result) throw new Error(result.error);
      debug(
        'read',
        readAt.toFixed(1),
        `${Math.round(performance.now() - now)} ms`,
        result.lines.map(
          (l) =>
            `${l.text} (${l.score.toFixed(2)} @${Math.round(l.box.x)},${Math.round(l.box.y)} ${Math.round(l.box.width)}×${Math.round(l.box.height)} text ${maskDensity(mask, width, l.box).toFixed(3)})`,
        ),
      );
      this.lastRead = mask;

      const seconds = performance.now() / 1000;
      this.watermarks.update(
        result.lines.map((l) => l.text),
        seconds,
      );
      const lines = preferOutlined(
        subtitleLines(result.lines, width).filter((l) => !this.watermarks.isWatermark(l.text, seconds)),
        mask,
        width,
      ).sort((a, b) => a.box.y - b.box.y);
      const box = unionBox(lines.map((l) => l.box));
      if (!box) {
        // Text-like pixels but no subtitle (a bright, busy scene): read less often until one turns up.
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        this.nextRead = performance.now() + this.backoff;
        return;
      }
      this.backoff = TICK_MS;

      const text = lines.map((l) => l.text).join(' ');
      if (hasKana(text)) this.japanese = true; // once Japanese, the whole video is
      const from: SubtitleLang = subtitleLanguage(text, this.japanese);
      const key = `${from}:${normalizeLine(text)}`;
      let english = this.cache.get(key);
      if (english === undefined) {
        english = (await this.translate!(text, from)).trim();
        this.cache.set(key, english);
      }
      if (generation !== this.generation) return;
      debug('show', video.currentTime.toFixed(1), `${Math.round(performance.now() - now)} ms after the frame`, text, '→', english);
      const region = maskRegion(mask, width, box);
      // The same English again (a re-read of the same line): it keeps its time on screen.
      this.errors = 0; // counted until a line makes it through, so failures that keep happening are reported
      const shownAt = this.shown?.english === english ? this.shown.shownAt : performance.now();
      this.show({ english, box, stripHeight: height, region, count: maskCount(region), shownAt, changedAt: 0 });
    } catch (err) {
      if (generation !== this.generation) return;
      debug('error', err);
      this.lastRead = null; // try this line again
      if (++this.errors >= 3) {
        this.onStatus(`EN subs stopped: ${err instanceof Error ? err.message : String(err)}`, true);
        this.stop();
      }
    } finally {
      this.busy = false;
    }
  }

  private show(shown: Shown) {
    this.shown = shown;
    this.place();
  }

  private hide() {
    this.shown = null;
    this.el.hidden = true;
    this.clearCues();
  }

  /** Re-positions the English box (after a resize, entering full screen…). */
  place() {
    const shown = this.shown;
    if (!shown) return;
    const video = this.video;
    for (const [name, value] of Object.entries(subtitleLookVars(look.background))) {
      this.el.style.setProperty(name, value);
      video.style.setProperty(name, value); // for the native caption (::cue)
    }
    if (document.fullscreenElement === video) {
      // The <video> itself is full screen: nothing can be drawn over it, so use a native caption.
      this.el.hidden = true;
      return this.showCue(shown);
    }
    this.clearCues();
    const rect = video.getBoundingClientRect();
    const picture = pictureRect(
      { x: 0, y: 0, width: rect.width, height: rect.height },
      video.videoWidth,
      video.videoHeight,
      getComputedStyle(video).objectFit,
    );
    const box = stripBoxToScreen(shown.box, picture, STRIP_WIDTH, shown.stripHeight);
    const pad = Math.max(4, box.height * 0.15);
    const style = this.el.style;
    style.left = `${box.x + box.width / 2}px`;
    style.bottom = `${rect.height - (box.y + box.height) - pad}px`;
    style.minWidth = `${box.width + pad * 2}px`;
    style.minHeight = `${box.height + pad * 2}px`;
    style.maxWidth = `${picture.width * 0.96}px`;
    style.fontSize = `${Math.max(12, Math.min(40, picture.height * 0.045)) * (look.size / 100)}px`;
    this.el.textContent = shown.english;
    this.el.hidden = false;
  }

  private showCue(shown: Shown) {
    const video = this.video;
    if (!this.track) {
      this.track = video.addTextTrack('subtitles', 'English', 'en');
      video.dataset.javtrSubs = '';
    }
    this.track.mode = 'showing';
    this.clearCues();
    const cue = new VTTCue(video.currentTime, video.currentTime + 30, shown.english);
    // Line position: where the original line is, as a percentage of the picture height.
    const top = 1 - STRIP_FRACTION + (STRIP_FRACTION * shown.box.y) / shown.stripHeight;
    cue.snapToLines = false;
    cue.line = Math.min(95, Math.round(top * 100));
    this.track.addCue(cue);
  }

  private clearCues() {
    const cues = this.track?.cues;
    if (!cues) return;
    for (const cue of [...cues]) this.track!.removeCue(cue);
  }
}
