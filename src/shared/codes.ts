// Detecting and normalizing video codes like "NSFS-484", and building javtrailers.com URLs.

export interface VideoCode {
  /** Lowercase label prefix, e.g. "nsfs" (may start with digits, e.g. "300mium"). */
  prefix: string;
  /** Numeric part without leading zeros, e.g. 484. */
  number: number;
}

export type OpenMode = 'search' | 'video';

const BASE_URL = 'https://javtrailers.com';

// Prefixes that look like codes but are common in normal text ("SHA-256", "COVID-19", ...).
const BLOCKLIST = new Set([
  'aes', 'am', 'ansi', 'atx', 'cve', 'ddr', 'en', 'es', 'gddr', 'gtx', 'hdmi', 'iec', 'ieee',
  'ip', 'iso', 'lpddr', 'mp', 'nato', 'pc', 'pcie', 'pm', 'ps', 'rfc', 'rsa', 'rtx', 'rx',
  'sha', 'tv', 'usb', 'utf', 'win', 'covid', 'sars', 'f', 'mig', 'su', 'boeing', 'airbus', 'top',
  'page', 'part', 'vol', 'no', 'item', 'step', 'room', 'type', 'model', 'version',
]);

// Strict pattern used when scanning pages: uppercase letters, a hyphen, 3–5 digits. "NSFS-484"
const SCAN_PATTERN = /(?<![A-Za-z0-9])(\d{0,4}[A-Z]{2,8})-(\d{3,5})(?![A-Za-z0-9])/g;
// Same shape but any case; used for selections and URLs. "nsfs-484"
const HYPHEN_PATTERN = /(?<![A-Za-z0-9])(\d{0,4}[A-Za-z]{2,8})-(\d{2,6})(?![A-Za-z0-9])/i;
// Lenient fallback for selections: "nsfs00484", "NSFS 484", "nsfs_484".
const LOOSE_PATTERN = /(?<![A-Za-z])([A-Za-z]{2,8})[ _]?(\d{2,6})(?!\d)/i;

function toCode(prefix: string, digits: string): VideoCode | null {
  const p = prefix.toLowerCase();
  const n = parseInt(digits, 10);
  if (BLOCKLIST.has(p.replace(/^\d+/, '')) || !Number.isFinite(n) || n === 0) return null;
  return { prefix: p, number: n };
}

/** Parse a single code from free text (a selection, a link URL, user input). */
export function parseCode(text: string): VideoCode | null {
  const strict = text.match(HYPHEN_PATTERN);
  if (strict) {
    const code = toCode(strict[1], strict[2]);
    if (code) return code;
  }
  const loose = text.match(LOOSE_PATTERN);
  return loose ? toCode(loose[1], loose[2]) : null;
}

// A whole URL path segment that is a code: "MD0273", "nsfs-484", "nsfs00484", "259LUXU1759.html".
const SEGMENT_PATTERN = /^(\d{0,4}[A-Za-z]{2,8})[-_]?(\d{3,6})(?:\.html?)?$/;

// javtrailers.com files titles under the studio's ID: "1dldss00578" is DLDSS-578, "118abp00100" ABP-100,
// "h_237nacr00914" NACR-914. It only has studio titles (no 300MIUM-style labels), so there, digits in front
// are never part of the code.
const STUDIO_ID_PREFIX = /^(?:h_)?\d+(?=[A-Za-z])/;

/**
 * The code a page's address is about, when its last path segment is exactly a code: "/videos/MD0273",
 * "/en/nsfs-484". Video pages that never write the code with a hyphen are found this way.
 */
export function codeInUrl(url: string): VideoCode | null {
  let segment: string | undefined;
  try {
    const { hostname, pathname } = new URL(url);
    segment = pathname.split('/').filter(Boolean).at(-1);
    segment = segment && decodeURIComponent(segment);
    if (segment && /(^|\.)javtrailers\.com$/.test(hostname)) segment = segment.replace(STUDIO_ID_PREFIX, '');
  } catch {
    return null;
  }
  const m = segment?.match(SEGMENT_PATTERN);
  return m ? toCode(m[1], m[2]) : null;
}

export interface CodeMatch {
  code: VideoCode;
  index: number;
  length: number;
}

/** Find all code occurrences in page text (strict matching to avoid false positives). */
export function findCodes(text: string): CodeMatch[] {
  const matches: CodeMatch[] = [];
  for (const m of text.matchAll(SCAN_PATTERN)) {
    const code = toCode(m[1], m[2]);
    if (code) matches.push({ code, index: m.index, length: m[0].length });
  }
  return matches;
}

const HYPHEN_PATTERN_G = new RegExp(HYPHEN_PATTERN.source, 'gi');
const LOOSE_EXACT = /^\s*([A-Za-z]{2,8})[ _]?(\d{2,6})\s*$/;

/**
 * Codes in text the user typed into a field: any-case "nsfs-484" anywhere,
 * or the whole field being a code without hyphen ("nsfs00484", "NSFS 484").
 */
export function findTypedCodes(text: string): CodeMatch[] {
  const matches: CodeMatch[] = [];
  for (const m of text.matchAll(HYPHEN_PATTERN_G)) {
    const code = toCode(m[1], m[2]);
    if (code) matches.push({ code, index: m.index, length: m[0].length });
  }
  if (matches.length === 0) {
    const m = text.match(LOOSE_EXACT);
    const code = m && toCode(m[1], m[2]);
    if (m && code) matches.push({ code, index: text.indexOf(m[1]), length: m[0].trim().length });
  }
  return matches;
}

/** The typed code under the caret, else the closest one before it, else the first. */
export function codeNearCaret(text: string, caret: number): VideoCode | null {
  const matches = findTypedCodes(text);
  if (matches.length === 0) return null;
  const containing = matches.find((m) => caret >= m.index && caret <= m.index + m.length);
  const before = matches.filter((m) => m.index + m.length <= caret).at(-1);
  return (containing ?? before ?? matches[0]).code;
}

/** "NSFS-484" */
export function formatCode({ prefix, number }: VideoCode): string {
  return `${prefix.toUpperCase()}-${String(number).padStart(3, '0')}`;
}

/** https://javtrailers.com/search/nsfs-484 */
export function searchUrl(code: VideoCode): string {
  return `${BASE_URL}/search/${encodeURIComponent(formatCode(code).toLowerCase())}`;
}

/** https://javtrailers.com/video/nsfs00484 */
export function videoUrl({ prefix, number }: VideoCode): string {
  return `${BASE_URL}/video/${prefix}${String(number).padStart(5, '0')}`;
}

/**
 * The address of `code`'s page among the links of a javtrailers search page (its HTML), e.g.
 * "https://javtrailers.com/video/1dldss00578". The site files some titles under the studio's own ID, a
 * number or "h_123" in front of the code, so their page can't be worked out from the code alone. Null when
 * the search doesn't list it.
 */
export function videoUrlIn(searchHtml: string, { prefix, number }: VideoCode): string | null {
  const id = new RegExp(`^(?:h_)?\\d*${prefix}0*${number}$`, 'i');
  for (const m of searchHtml.matchAll(/href="\/video\/([\w-]+)"/g)) {
    if (id.test(m[1])) return `${BASE_URL}/video/${m[1]}`;
  }
  return null;
}

export function trailerUrl(code: VideoCode, mode: OpenMode): string {
  // Prefixes starting with digits (e.g. "300MIUM") don't follow the padded video-id scheme.
  if (mode === 'video' && !/^\d/.test(code.prefix)) return videoUrl(code);
  return searchUrl(code);
}

/** Fallback search for text that doesn't parse as a code. */
export function rawSearchUrl(text: string): string {
  return `${BASE_URL}/search/${encodeURIComponent(text.trim().toLowerCase())}`;
}
