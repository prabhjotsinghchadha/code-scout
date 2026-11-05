// Favourite actresses: names the user saved, each with the page she was saved from (her page on a site),
// if any. Kept in chrome.storage.sync like the favourite videos (favourites.ts): one key per actress
// ("actress:yua mikami"), so saving on two devices at once never overwrites the other's. They share sync's
// 512-key limit with the favourite videos.
import { rawSearchUrl } from './codes.ts';
import { UNSTARRED_PREFIX } from './favourites.ts';
import { cleanName, nameAfterPathWord, nameKey } from './names.ts';
import { isWebUrl } from './open-on.ts';

// Name helpers shared with favourite tags (names.ts), re-exported for callers of this module.
export { capitalized, cleanName, nameKey } from './names.ts';

export interface Actress {
  /** As the user saved it: "Yua Mikami". */
  name: string;
  /** The page she was saved from (her page on a site). */
  url?: string;
  /** When she was saved (ms since epoch); listed newest first. */
  added: number;
}

const PREFIX = 'actress:';
const MAX_URL = 2048;

/** "actress:yua mikami" */
export function actressKey(name: string): string {
  return PREFIX + nameKey(name);
}

export function isActressKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

/**
 * Words that start the address of an actress's page on the sites people use: /actresses/Yua Mikami
 * (MissAV), /casts/… (javtrailers), /models/… (Jable), /actress/… (Jav Guru), /star/… (JavMost),
 * /pornstar/… and /model/… (Pornhub), /actors/… (JavDB).
 */
export const ACTRESS_PATH_WORDS = [
  'actress', 'actresses', 'actor', 'actors', 'cast', 'casts', 'model', 'models', 'star', 'stars',
  'pornstar', 'pornstars', 'idol', 'idols', 'performer', 'performers',
];

/** For the right-click menu's link patterns; the same pages as looksLikeActressUrl. */
export const ACTRESS_LINK_PATTERNS = [
  ...ACTRESS_PATH_WORDS.map((w) => `*://*/*${w}/*`),
  '*://*/*_star.php*', // JavLibrary: /en/vl_star.php?s=…
];

const ACTRESS_PATH = new RegExp(`(?:${ACTRESS_PATH_WORDS.join('|')})/[^/]|_star\\.php$`, 'i');

/** True if `url` looks like an actress's page ("/actresses/Yua Mikami"). */
export function looksLikeActressUrl(url: string): boolean {
  if (!isWebUrl(url)) return false;
  return ACTRESS_PATH.test(new URL(url).pathname);
}

/**
 * A name from an actress page's address, for a link with no text: "/casts/yua-mikami" → "Yua Mikami".
 * Null when the address has no readable name (an id like "12345" or "vl_star.php?s=ae5q").
 */
export function nameFromUrl(url: string): string | null {
  return nameAfterPathWord(url, ACTRESS_PATH_WORDS);
}

/** Where an actress opens: the page she was saved from, else a javtrailers search for her name. */
export function actressLink(actress: Actress): string {
  return actress.url ?? rawSearchUrl(actress.name);
}

/** The stored record: the page only if it's an http(s) URL that isn't too long. */
export function makeActress(name: string, url: string | null | undefined, now: number): Actress {
  const actress: Actress = { name, added: now };
  if (url && isWebUrl(url) && url.length <= MAX_URL) actress.url = url;
  return actress;
}

/** Actresses from a dump of sync storage (other keys and malformed entries ignored), newest first. */
export function actressesFrom(dump: Record<string, unknown>): Actress[] {
  const list: Actress[] = [];
  for (const [key, value] of Object.entries(dump)) {
    if (!isActressKey(key) || !value || typeof value !== 'object') continue;
    const { name, url, added } = value as Partial<Actress>;
    if (typeof name !== 'string' || !cleanName(name) || typeof added !== 'number') continue;
    list.push(makeActress(name, typeof url === 'string' ? url : null, added));
  }
  return list.sort((a, b) => b.added - a.added);
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const LATIN_NAME = /^[\p{Script=Latin}\d\s'.-]+$/u;
// Letters that can't touch a Latin name: "Ai" isn't found in "Paid". Other scripts (三上悠亜) have no
// spaces between words, so their names are found anywhere.
const NOT_AFTER = '(?<![\\p{Script=Latin}\\d])';
const NOT_BEFORE = '(?![\\p{Script=Latin}\\d])';

/**
 * A finder for these names in text: it returns the names found (as given, each once), ignoring case and
 * spacing. A two-word Latin name is also found the other way round ("Mikami Yua" for "Yua Mikami"), as
 * sites write Japanese names in either order.
 */
export function actressMatcher(names: string[]): (text: string) => string[] {
  const usable = [...new Set(names.map((n) => cleanName(n)).filter((n): n is string => !!n))];
  if (!usable.length) return () => [];
  // Longer names first, so "Yua Mikami" wins over a favourite called "Yua".
  usable.sort((a, b) => b.length - a.length);
  const groups = usable.map((name) => {
    const words = name.split(' ').map((w) => w.replace(RE_SPECIAL, '\\$&'));
    const latin = LATIN_NAME.test(name);
    const orders = [words.join('\\s+')];
    if (latin && words.length === 2) orders.push(`${words[1]}\\s+${words[0]}`);
    const body = orders.join('|');
    return latin ? `(${NOT_AFTER}(?:${body})${NOT_BEFORE})` : `(${body})`;
  });
  const re = new RegExp(groups.join('|'), 'giu');
  return (text) => {
    const found = new Set<string>();
    for (const m of text.matchAll(re)) {
      const i = m.findIndex((g, j) => j > 0 && g !== undefined);
      if (i > 0) found.add(usable[i - 1]);
    }
    return [...found];
  };
}

// --- chrome.storage.sync ---

export async function getActresses(): Promise<Actress[]> {
  return actressesFrom(await chrome.storage.sync.get(null));
}

export async function isFavouriteActress(name: string): Promise<boolean> {
  const key = actressKey(name);
  return key in (await chrome.storage.sync.get(key));
}

/** Saves `name` (see cleanName) with her page unless she's saved already (then her page is kept). True if added. */
export async function addActress(name: string, url?: string | null, now = Date.now()): Promise<boolean> {
  const clean = cleanName(name);
  if (!clean || (await isFavouriteActress(clean))) return false;
  await chrome.storage.sync.set({ [actressKey(clean)]: makeActress(clean, url, now) });
  return true;
}

export async function removeActress(name: string): Promise<void> {
  const key = actressKey(name);
  await chrome.storage.sync.remove(key);
  // So her bookmark in the backup can go (see fav-backup.ts).
  await chrome.storage.local.set({ [UNSTARRED_PREFIX + key]: Date.now() });
}

/** Saves or removes `name`; true if she is a favourite afterwards. */
export async function toggleActress(name: string, url?: string | null): Promise<boolean> {
  if (await isFavouriteActress(name)) {
    await removeActress(name);
    return false;
  }
  return addActress(name, url);
}

/** Calls `callback` whenever an actress is saved or removed, on this device or another. */
export function onActressesChanged(callback: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(isActressKey)) callback();
  });
}
