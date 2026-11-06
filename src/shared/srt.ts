// Subtitle files (.srt, .vtt): reading them, whatever their text encoding, into timed lines.
// Used by the video toolbar's CC menu (srt-subs.ts) for files found on SubtitleCat or loaded from disk.
import { cjkCount, hasKana } from './subtitles.ts';

export interface Cue {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

// "00:01:02,345", "01:02.345" (WebVTT may leave out the hours), "0:01:02.3"
const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?/;
const TIMING = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`);

function seconds(h: string | undefined, m: string, s: string, ms: string | undefined): number {
  // "3" after the separator is 300 ms, as written in short timestamps ("00:01:02,3").
  const fraction = ms ? Number(ms.padEnd(3, '0')) / 1000 : 0;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + fraction;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** A cue's text without markup: <i>, <font …>, {\an8}-style override tags, entities. */
export function cleanCueText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\\N/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** "Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,Text" lines of an .ass / .ssa file. */
function parseAss(lines: string[]): Cue[] {
  // The [Events] section's Format line says where the times and text are (this is the usual order).
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const cues: Cue[] = [];
  for (const line of lines) {
    const format = line.match(/^Format:\s*(.*)$/i);
    if (format && /\btext\b/i.test(format[1])) fields = format[1].split(',').map((f) => f.trim().toLowerCase());
    const dialogue = line.match(/^Dialogue:\s*(.*)$/i);
    if (!dialogue) continue;
    const parts = dialogue[1].split(',');
    const textAt = fields.indexOf('text');
    const values = [...parts.slice(0, textAt), parts.slice(textAt).join(',')]; // the text may have commas
    const time = (field: string) => {
      const m = values[fields.indexOf(field)]?.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
      return m ? seconds(m[1], m[2], m[3], m[4]) : NaN;
    };
    const start = time('start');
    const end = time('end');
    const cleaned = cleanCueText(values[textAt] ?? '');
    if (cleaned && end > start) cues.push({ start, end, text: cleaned });
  }
  return cues;
}

/** The timed lines of an .srt, .vtt or .ass file, in order of when they start. Lines with no text are left out. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lines.some((line) => /^Dialogue:/i.test(line))) return parseAss(lines).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TIMING);
    if (!m) continue;
    const start = seconds(m[1], m[2], m[3], m[4]);
    const end = seconds(m[5], m[6], m[7], m[8]);
    const body: string[] = [];
    // The text runs to the next blank line, or to the next timing line in a file that leaves out the
    // blank lines (its cue number is then the line before it).
    while (i + 1 < lines.length && lines[i + 1].trim() && !TIMING.test(lines[i + 1])) body.push(lines[++i]);
    if (i + 1 < lines.length && TIMING.test(lines[i + 1]) && /^\d+$/.test(body.at(-1)?.trim() ?? '')) body.pop();
    const cleaned = cleanCueText(body.join('\n'));
    if (cleaned && end > start) cues.push({ start, end, text: cleaned });
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** How many cues back a line that's still up can be (lines overlap a little, not a lot). */
const OVERLAP = 8;

/** Index of the first cue starting after `time` (cues.length when none does). */
function firstAfter(cues: Cue[], time: number): number {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The lines on screen at `time` (usually one; two when they overlap), in order. */
export function cuesAt(cues: Cue[], time: number): Cue[] {
  const after = firstAfter(cues, time);
  const on: Cue[] = [];
  for (let i = Math.max(0, after - OVERLAP); i < after; i++) if (cues[i].end > time) on.push(cues[i]);
  return on;
}

/** Index of the first line still to come or on screen at `time`: where to translate from. */
export function nextCueIndex(cues: Cue[], time: number): number {
  const after = firstAfter(cues, time);
  for (let i = Math.max(0, after - OVERLAP); i < after; i++) if (cues[i].end > time) return i;
  return after;
}

/**
 * What a subtitle file is written in: Japanese or Chinese when most of it is in their characters
 * (Japanese when it has kana), else something else (English, usually). A machine-translated English file
 * often keeps a line or two of the original, which doesn't count.
 */
export function cueLanguage(cues: Cue[]): 'ja' | 'zh' | 'other' {
  let cjk = 0;
  let all = 0;
  let kanaLines = 0;
  for (const cue of cues) {
    if (hasKana(cue.text)) kanaLines++;
    cjk += cjkCount(cue.text);
    all += cue.text.replace(/\s/g, '').length;
  }
  if (!all || cjk / all < 0.3) return 'other';
  return kanaLines >= cues.length * 0.05 ? 'ja' : 'zh';
}

const CJK_CHAR = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々、。！？「」…]';
const CJK_SPACE = new RegExp(`(?<=${CJK_CHAR})\\s+(?=${CJK_CHAR})`, 'gu');

/**
 * A Japanese or Chinese line as written, without the spaces machine transcriptions put between words
 * ("そう じゃ ん、 この 焼 き そ ば。" → "そうじゃん、この焼きそば。"), which put the translator off.
 */
export function joinCjkSpaces(text: string): string {
  return text.replace(CJK_SPACE, '');
}

/** Characters that show a file was read with the wrong encoding: the replacement character, and
 * half-width katakana (what Chinese GBK text turns into when read as Shift-JIS). */
function garbage(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '�' || (ch >= '｡' && ch <= 'ﾟ')) n++;
  return n;
}

function decode(bytes: Uint8Array, encoding: string, fatal = false): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes);
  } catch {
    return null; // not this encoding (or not supported here)
  }
}

/**
 * A subtitle file's text. Most are UTF-8 (or UTF-16 with a byte-order mark); older Japanese ones are
 * Shift-JIS and older Chinese ones GBK. Almost any bytes read as GBK without an error, so Shift-JIS is
 * tried first and kept when it reads cleanly and has kana in it.
 */
export function decodeSubtitleFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes, 'utf-16le') ?? '';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes, 'utf-16be') ?? '';
  const utf8 = decode(bytes, 'utf-8', true);
  if (utf8 !== null) return utf8;
  const sjis = decode(bytes, 'shift_jis', true);
  if (sjis !== null && hasKana(sjis) && garbage(sjis) < sjis.length * 0.01) return sjis;
  return decode(bytes, 'gb18030') ?? decode(bytes, 'utf-8') ?? '';
}

/** "+1.5 s", "−0.5 s", "0 s" */
export function offsetText(offset: number): string {
  const rounded = Math.round(offset * 10) / 10;
  if (!rounded) return '0 s';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1).replace(/\.0$/, '')} s`;
}
