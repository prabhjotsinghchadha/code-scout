// Names the user saves as favourites (actresses, tags): tidying them, comparing them, and reading one
// from a page's address.
import { isWebUrl } from './open-on.ts';

const MAX_NAME = 60;

/** The same name however it's spaced or capitalized: "yua mikami". */
export function nameKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A name from a link's text, a selection or the popup: spaces tidied, without a leading "#" or a trailing
 * count ("Yua Mikami (152)", "NTR 2,341 videos"). Null if it can't be a name: under 2 or over 60
 * characters (a whole sentence selected), or no letters.
 */
export function cleanName(text: string): string | null {
  const name = text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#\s*/, '')
    .replace(/\s*[([【]\s*\d[\d,.]*\s*(?:videos?|movies?|titles?)?\s*[)\]】]$/i, '')
    .replace(/\s+\d[\d,.]*\s*(?:videos?|movies?|titles?)?$/i, '')
    .trim();
  if (name.length < 2 || name.length > MAX_NAME || !/\p{L}/u.test(name)) return null;
  return name;
}

/** "ai uehara" → "Ai Uehara". A name with any capitals, or in a script without them, is kept as it is. */
export function capitalized(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/**
 * The name in an address, in the path segment after one of `words`: "/casts/yua-mikami" → "Yua Mikami",
 * "/categories/cheating-wife" → "Cheating Wife". Null when there's no readable name there (an id like
 * "12345", or no such word).
 */
export function nameAfterPathWord(url: string, words: string[]): string | null {
  if (!isWebUrl(url)) return null;
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  const at = segments.findIndex((s) => words.includes(s.toLowerCase()));
  let segment = at >= 0 ? segments[at + 1] : undefined;
  if (!segment) return null;
  try {
    segment = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const spaced = segment.replace(/\.html?$/i, '').replace(/[-_+]+/g, ' ');
  if (/\d/.test(spaced)) return null; // an id, not a name
  const name = cleanName(spaced);
  return name && capitalized(name);
}
