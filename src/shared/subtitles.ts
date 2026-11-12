// Helpers for reading burned-in subtitles off video frames (pure, unit-tested). The content script
// (subs.ts) captures the bottom of the frame, decides whether the line changed, and covers it with English.

/** The bottom part of the frame that is read for subtitles. */
export const STRIP_FRACTION = 0.3;
/** Width the strip is scaled to before OCR. */
export const STRIP_WIDTH = 960;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  box: Box;
  /** 0–1 */
  score: number;
}

const KANA = /[぀-ヿ]/;
const CJK_OR_KANA = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

export function hasKana(text: string): boolean {
  return KANA.test(text);
}

export function cjkCount(text: string): number {
  return text.match(CJK_OR_KANA)?.length ?? 0;
}

/** Japanese if the line has kana (or the video already did), otherwise Chinese. */
export function subtitleLanguage(text: string, videoIsJapanese: boolean): 'ja' | 'zh' {
  return videoIsJapanese || hasKana(text) ? 'ja' : 'zh';
}

/** For comparing lines: no spaces or punctuation. */
export function normalizeLine(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * Lines that look like subtitles: at least two Chinese/Japanese characters, confident, and roughly
 * centred (watermarks and logos sit in the corners). Coordinates are in strip pixels.
 */
export function subtitleLines(lines: OcrLine[], stripWidth: number, minScore = 0.6): OcrLine[] {
  return lines.filter((l) => {
    if (l.score < minScore || cjkCount(l.text) < 2) return false;
    const centre = l.box.x + l.box.width / 2;
    return centre > stripWidth * 0.2 && centre < stripWidth * 0.8;
  });
}

/** Smallest box around all of `boxes`. */
export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Where the picture is drawn inside the <video> element (object-fit: contain leaves bars around it).
 * `element` is the element's box on screen.
 */
export function pictureRect(element: Box, videoWidth: number, videoHeight: number, fit = 'contain'): Box {
  if (!videoWidth || !videoHeight || fit === 'fill') return element;
  const scale =
    fit === 'cover'
      ? Math.max(element.width / videoWidth, element.height / videoHeight)
      : Math.min(element.width / videoWidth, element.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { x: element.x + (element.width - width) / 2, y: element.y + (element.height - height) / 2, width, height };
}

/** A box in strip pixels (the bottom STRIP_FRACTION of the picture, scaled to stripWidth) → screen pixels. */
export function stripBoxToScreen(box: Box, picture: Box, stripWidth: number, stripHeight: number): Box {
  const sx = picture.width / stripWidth;
  const top = picture.y + picture.height * (1 - STRIP_FRACTION);
  const sy = (picture.height * STRIP_FRACTION) / stripHeight;
  return { x: picture.x + box.x * sx, y: top + box.y * sy, width: box.width * sx, height: box.height * sy };
}

/**
 * How much darker than a bright pixel something next to it must be to count as the edge of a letter.
 * A black outline is far darker; the soft grey shadow some subtitles have instead (white letters at
 * about 245 over a shadow of 100–160, on a scene that may itself be nearly white) is 85 or more darker,
 * while the folds of a white dress or a bright wall stay under 50.
 */
const EDGE_DROP = 70;

/**
 * Where subtitle text probably is: white or yellow pixels next to something clearly darker (subtitles are
 * drawn with a black border or a grey shadow), in the middle 70% of the width where subtitles sit. Sampled
 * every `step` pixels; returns 1 per sampled pixel that qualifies (`Math.floor(width / step)` per row).
 */
export function textMask(rgba: Uint8ClampedArray, width: number, height: number, step = 2): Uint8Array {
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);
  const mask = new Uint8Array(cols * rows);
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  const reach = 3;
  const left = width * 0.15;
  const right = width * 0.85;
  for (let r = 0; r < rows; r++) {
    const y = r * step;
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      const own = luma(x, y);
      if (x < left || x > right || own < 190) continue;
      const i = (y * width + x) * 4;
      const [red, green, blue] = [rgba[i], rgba[i + 1], rgba[i + 2]];
      const white = Math.max(red, green, blue) - Math.min(red, green, blue) <= 45;
      const yellow = red > 190 && green > 170 && blue < 140;
      if (!white && !yellow) continue;
      const edge = own - EDGE_DROP;
      let dark = false;
      for (let d = 1; d <= reach && !dark; d++) {
        dark =
          (x - d >= 0 && luma(x - d, y) < edge) ||
          (x + d < width && luma(x + d, y) < edge) ||
          (y - d >= 0 && luma(x, y - d) < edge) ||
          (y + d < height && luma(x, y + d) < edge);
      }
      if (dark) mask[r * cols + c] = 1;
    }
  }
  return mask;
}

/** The part of a text mask inside `box` (strip pixels, plus a margin), to follow one subtitle line. */
export function maskRegion(mask: Uint8Array, width: number, box: Box, step = 2, margin = 4): Uint8Array {
  const cols = Math.floor(width / step);
  const rows = Math.floor(mask.length / cols);
  const c0 = Math.max(0, Math.floor((box.x - margin) / step));
  const c1 = Math.min(cols - 1, Math.floor((box.x + box.width + margin) / step));
  const r0 = Math.max(0, Math.floor((box.y - margin) / step));
  const r1 = Math.min(rows - 1, Math.floor((box.y + box.height + margin) / step));
  if (c1 < c0 || r1 < r0) return new Uint8Array(0);
  const out = new Uint8Array((c1 - c0 + 1) * (r1 - r0 + 1));
  let k = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out[k++] = mask[r * cols + c];
  return out;
}

export function maskCount(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** Share of text pixels that differ between two masks (0 = same line, 1 = nothing in common). */
export function maskDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1;
  let differ = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) either++;
    if (a[i] !== b[i]) differ++;
  }
  return either ? differ / either : 0;
}

/** Few enough text-like pixels that there's no subtitle on screen. */
export function isEmptyMask(mask: Uint8Array): boolean {
  return maskCount(mask) < Math.max(12, mask.length * 0.002);
}

/**
 * Text that stays on screen unchanged for a long time is a watermark or logo, not a subtitle.
 * Call `update` with every OCR result; `isWatermark` then tells the long-lived lines apart.
 */
export class WatermarkTracker {
  private firstSeen = new Map<string, number>();
  private readonly afterSeconds: number;

  constructor(afterSeconds = 20) {
    this.afterSeconds = afterSeconds;
  }

  /** `now` is in seconds (video time or wall clock, as long as it's consistent). */
  update(texts: string[], now: number) {
    const keys = new Set(texts.map(normalizeLine));
    for (const key of [...this.firstSeen.keys()]) if (!keys.has(key)) this.firstSeen.delete(key);
    for (const key of keys) if (!this.firstSeen.has(key)) this.firstSeen.set(key, now);
  }

  isWatermark(text: string, now: number): boolean {
    const since = this.firstSeen.get(normalizeLine(text));
    return since !== undefined && now - since >= this.afterSeconds;
  }

  reset() {
    this.firstSeen.clear();
  }
}

/** Small least-recently-used cache (e.g. Chinese line → English). */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  private readonly limit: number;

  constructor(limit = 500) {
    this.limit = limit;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as K);
  }

  get size() {
    return this.map.size;
  }
}

/** Below this background opacity the English text gets a dark outline, to stay readable on the picture. */
const OUTLINE_BELOW = 60;

/**
 * CSS variables for the English subtitle's look (Settings → Video tools): --javtr-sub-bg is the box's
 * opacity, --javtr-sub-shadow an outline when the box is see-through. Used by the overlay and the preview.
 */
export function subtitleLookVars(backgroundPercent: number): Record<'--javtr-sub-bg' | '--javtr-sub-shadow', string> {
  const bg = Math.min(100, Math.max(0, backgroundPercent));
  return {
    '--javtr-sub-bg': String(bg / 100),
    '--javtr-sub-shadow': bg < OUTLINE_BELOW ? '0 0 3px #000, 0 0 2px #000, 0 1px 2px #000' : 'none',
  };
}

/**
 * Share of `box` (strip pixels) covered by subtitle-style text pixels (textMask). Burned-in subtitles are
 * white or yellow with an outline or a shadow, so their boxes are well covered; other text the OCR finds
 * (a sign in the scene, an ad printed on a prop) has next to none.
 */
export function maskDensity(mask: Uint8Array, width: number, box: Box, step = 2): number {
  const region = maskRegion(mask, width, box, step, 0);
  return region.length ? maskCount(region) / region.length : 0;
}

/** Below this maskDensity a line isn't subtitle-style text (subtitles measure about 0.05–0.15). */
const MIN_TEXT_DENSITY = 0.01;

/**
 * When some lines are subtitle-style (outlined) text, keeps only those: drops a sign or an ad printed on a
 * prop that the OCR also read. When none are (a subtitle style the mask doesn't catch), keeps them all.
 */
export function preferOutlined<T extends { box: Box }>(lines: T[], mask: Uint8Array, width: number, step = 2): T[] {
  const outlined = lines.filter((l) => maskDensity(mask, width, l.box, step) >= MIN_TEXT_DENSITY);
  return outlined.length ? outlined : lines;
}
