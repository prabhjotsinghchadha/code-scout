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
  'ip', 'iso', 'lpddr', 'md', 'mp', 'nato', 'pc', 'pcie', 'pm', 'ps', 'rfc', 'rsa', 'rtx', 'rx',
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

export function trailerUrl(code: VideoCode, mode: OpenMode): string {
  // Prefixes starting with digits (e.g. "300MIUM") don't follow the padded video-id scheme.
  if (mode === 'video' && !/^\d/.test(code.prefix)) return videoUrl(code);
  return searchUrl(code);
}

/** Fallback search for text that doesn't parse as a code. */
export function rawSearchUrl(text: string): string {
  return `${BASE_URL}/search/${encodeURIComponent(text.trim().toLowerCase())}`;
}
