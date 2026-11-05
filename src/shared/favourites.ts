// Favourite videos: codes the user starred, with the page they were starred on, and pages starred on their own
// (a video page with no code). Kept in chrome.storage.sync with one key per favourite ("fav:NSFS-484",
// "favurl:https://…"), so starring on two devices at once never overwrites the other device's favourites and
// no single item nears the 8 KB-per-item limit. Sync allows 512 keys in all, so about 500 favourites fit.
import { codeInUrl, formatCode, parseCode, type VideoCode } from './codes.ts';
import { isWebUrl } from './open-on.ts';

/** The page a favourite was starred on. */
export interface FavouritePage {
  url: string;
  title?: string;
}

/** What is stored under a favourite's key (a page favourite's address is its key, so it has no url). */
export interface FavouriteData {
  url?: string;
  title?: string;
  /** When it was starred (ms since epoch); favourites are listed newest first. */
  added: number;
}

/** A starred code (with the page it was starred on, if saved), or a starred page with no code. */
export type Favourite = (FavouriteData & { code: VideoCode }) | (FavouriteData & { code?: undefined; url: string });

const PREFIX = 'fav:';
const PAGE_PREFIX = 'favurl:';
const MAX_TITLE = 100;
const MAX_URL = 2048;

export const FAVOURITES_FULL = 'Favourites are full. Remove some to add more.';

/** "fav:NSFS-484" */
export function favKey(code: VideoCode): string {
  return PREFIX + formatCode(code);
}

/** A page's address as a favourite: without its #fragment. Null if it can't be one (not http(s), too long). */
export function pageUrl(url: string): string | null {
  if (!isWebUrl(url)) return null;
  const u = new URL(url);
  u.hash = '';
  return u.href.length <= MAX_URL ? u.href : null;
}

/** "favurl:https://www.pornhub.com/view_video.php?viewkey=…" */
export function pageKey(url: string): string | null {
  const page = pageUrl(url);
  return page && PAGE_PREFIX + page;
}

export function isFavKey(key: string): boolean {
  return key.startsWith(PREFIX) || key.startsWith(PAGE_PREFIX);
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
    const { url, title, added } = value as Partial<FavouriteData>;
    if (typeof added !== 'number') continue;
    const named = typeof title === 'string' && title ? { title } : {};
    if (key.startsWith(PAGE_PREFIX)) {
      const page = pageUrl(key.slice(PAGE_PREFIX.length));
      if (page) favs.push({ url: page, added, ...named });
      continue;
    }
    const code = parseCode(key.slice(PREFIX.length));
    if (!code) continue;
    favs.push({ code, added, ...named, ...(typeof url === 'string' && isWebUrl(url) && { url }) });
  }
  return favs.sort((a, b) => b.added - a.added);
}

/**
 * The favourite that starring the page at `url` makes: the code in its address ("/videos/MD0273") when it has
 * one, else the page itself. Undefined if it isn't starred.
 */
export function favouriteFor(favs: Favourite[], url: string): Favourite | undefined {
  const page = pageUrl(url);
  if (!page) return undefined;
  const code = codeInUrl(page);
  if (code) return favs.find((f) => f.code && formatCode(f.code) === formatCode(code));
  return favs.find((f) => !f.code && f.url === page);
}

/** A message for a failed save: sync storage is full, or something else went wrong. */
export function favouriteError(err: unknown): string {
  return /quota|max_items/i.test(String(err)) ? FAVOURITES_FULL : 'Couldn’t save the favourite.';
}

// --- chrome.storage.sync ---

export async function getFavourites(): Promise<Favourite[]> {
  return favouritesFrom(await chrome.storage.sync.get(null));
}

/** "NSFS-484" for every starred code, for marking codes on pages. */
export async function favouriteCodes(): Promise<Set<string>> {
  return new Set((await getFavourites()).flatMap((f) => (f.code ? [formatCode(f.code)] : [])));
}

const has = async (key: string) => key in (await chrome.storage.sync.get(key));

export async function isFavourite(code: VideoCode): Promise<boolean> {
  return has(favKey(code));
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

/**
 * Stars the page you're on unless it already is: the code in its address with the page when it has one
 * (so it gets Open, Search and Sites), else the page itself. True if it was added.
 */
export async function addPageFavourite(page: FavouritePage, now = Date.now()): Promise<boolean> {
  const code = codeInUrl(page.url);
  if (code) return addFavourite(code, page, now);
  const key = pageKey(page.url);
  if (!key || (await has(key))) return false;
  const { title } = makeFavourite(page, now);
  await chrome.storage.sync.set({ [key]: { added: now, ...(title && { title }) } });
  return true;
}

/** Un-stars a favourite, a code or a page. */
export async function removeFavouriteEntry(fav: Favourite): Promise<void> {
  if (fav.code) return removeFavourite(fav.code);
  const key = pageKey(fav.url);
  if (key) await chrome.storage.sync.remove(key);
}

/** Stars or un-stars the page you're on (see addPageFavourite); true if it is a favourite afterwards. */
export async function togglePageFavourite(page: FavouritePage): Promise<boolean> {
  const fav = favouriteFor(await getFavourites(), page.url);
  if (fav) {
    await removeFavouriteEntry(fav);
    return false;
  }
  await addPageFavourite(page);
  return true;
}

/** Calls `callback` whenever a favourite is added or removed, on this device or another. */
export function onFavouritesChanged(callback: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(isFavKey)) callback();
  });
}
