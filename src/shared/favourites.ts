// Favourite videos: codes the user starred, with the page they were starred on. Kept in chrome.storage.sync
// with one key per favourite ("fav:NSFS-484"), so starring on two devices at once never overwrites the
// other device's favourites and no single item nears the 8 KB-per-item limit. Sync allows 512 keys in
// all, so about 500 favourites fit.
import { formatCode, parseCode, type VideoCode } from './codes.ts';
import { isWebUrl } from './open-on.ts';

/** The page a favourite was starred on. */
export interface FavouritePage {
  url: string;
  title?: string;
}

/** What is stored under a favourite's key. */
export interface FavouriteData {
  url?: string;
  title?: string;
  /** When it was starred (ms since epoch); favourites are listed newest first. */
  added: number;
}

export interface Favourite extends FavouriteData {
  code: VideoCode;
}

const PREFIX = 'fav:';
const MAX_TITLE = 100;
const MAX_URL = 2048;

export const FAVOURITES_FULL = 'Favourites are full. Remove some to add more.';

/** "fav:NSFS-484" */
export function favKey(code: VideoCode): string {
  return PREFIX + formatCode(code);
}

export function isFavKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

/** The stored record: the page only if it's an http(s) URL, with its title tidied and trimmed. */
export function makeFavourite(page: FavouritePage | null | undefined, now: number): FavouriteData {
  const data: FavouriteData = { added: now };
  if (page && isWebUrl(page.url) && page.url.length <= MAX_URL) {
    data.url = page.url;
    const title = page.title?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (title) data.title = title;
  }
  return data;
}

/** Favourites from a dump of sync storage (other keys and malformed entries ignored), newest first. */
export function favouritesFrom(dump: Record<string, unknown>): Favourite[] {
  const favs: Favourite[] = [];
  for (const [key, value] of Object.entries(dump)) {
    if (!isFavKey(key) || !value || typeof value !== 'object') continue;
    const code = parseCode(key.slice(PREFIX.length));
    const { url, title, added } = value as Partial<FavouriteData>;
    if (!code || typeof added !== 'number') continue;
    favs.push({
      code,
      added,
      ...(typeof url === 'string' && isWebUrl(url) && { url }),
      ...(typeof title === 'string' && title && { title }),
    });
  }
  return favs.sort((a, b) => b.added - a.added);
}

/** A message for a failed save: sync storage is full, or something else went wrong. */
export function favouriteError(err: unknown): string {
  return /quota|max_items/i.test(String(err)) ? FAVOURITES_FULL : 'Couldn’t save the favourite.';
}

// --- chrome.storage.sync ---

export async function getFavourites(): Promise<Favourite[]> {
  return favouritesFrom(await chrome.storage.sync.get(null));
}

/** "NSFS-484" for every favourite, for marking codes on pages. */
export async function favouriteCodes(): Promise<Set<string>> {
  return new Set((await getFavourites()).map((f) => formatCode(f.code)));
}

export async function isFavourite(code: VideoCode): Promise<boolean> {
  const key = favKey(code);
  return key in (await chrome.storage.sync.get(key));
}

/** Stars `code` unless it already is (then its saved page is kept). True if it was added. */
export async function addFavourite(code: VideoCode, page?: FavouritePage | null, now = Date.now()): Promise<boolean> {
  if (await isFavourite(code)) return false;
  await chrome.storage.sync.set({ [favKey(code)]: makeFavourite(page, now) });
  return true;
}

export async function removeFavourite(code: VideoCode): Promise<void> {
  await chrome.storage.sync.remove(favKey(code));
}

/** Stars or un-stars `code`; true if it is a favourite afterwards. */
export async function toggleFavourite(code: VideoCode, page?: FavouritePage | null): Promise<boolean> {
  if (await isFavourite(code)) {
    await removeFavourite(code);
    return false;
  }
  await addFavourite(code, page);
  return true;
}

/** Calls `callback` whenever a favourite is added or removed, on this device or another. */
export function onFavouritesChanged(callback: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(isFavKey)) callback();
  });
}
