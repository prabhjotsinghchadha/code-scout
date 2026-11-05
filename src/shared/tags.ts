// Favourite tags: categories like "NTR" or "Cheating Wife", each with its tag pages on the sites the user
// saved it from, so it opens on all of them at once. Kept in chrome.storage.sync like the other favourites:
// one key per tag ("tag:cheating wife"), sharing sync's 512-key limit with them.
import { rawSearchUrl } from './codes.ts';
import { pageUrl, UNSTARRED_PREFIX } from './favourites.ts';
import { cleanName, nameAfterPathWord, nameKey } from './names.ts';

export interface Tag {
  /** As first saved: "Cheating Wife". */
  name: string;
  /** Its tag pages on different sites, oldest first. */
  pages: string[];
  /** When it was saved (ms since epoch); listed newest first. */
  added: number;
}

const PREFIX = 'tag:';
/** At most this many pages per tag, each at most MAX_PAGE_URL long: a tag stays well under sync's 8 KB per item. */
const MAX_PAGES = 12;
const MAX_PAGE_URL = 512;

/** One tag however it's written: "cheating wife" for "Cheating Wife", "cheating-wife" and "CHEATING_WIFE". */
export function tagNameKey(name: string): string {
  return nameKey(name.replace(/[-_]+/g, ' '));
}

/** "tag:cheating wife" */
export function tagKey(name: string): string {
  return PREFIX + tagNameKey(name);
}

export function isTagKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

/** The key for one of a tag's pages, in the backup and its un-star notes: "tag:ntr|https://…". */
export function tagPageKey(name: string, page: string): string {
  return `${tagKey(name)}|${page}`;
}

/** "tag:ntr" from "tag:ntr|https://…" (or the tag key itself). */
export function tagOfPageKey(key: string): string {
  const at = key.indexOf('|http');
  return at < 0 ? key : key.slice(0, at);
}

/**
 * Words that start a tag page's address: /categories/cheating-wife (javtrailers), /genres/NTR (MissAV),
 * /category/affair (Javtiful, Jav Guru), /tags/… and /tag/… (many others).
 */
export const TAG_PATH_WORDS = ['tag', 'tags', 'genre', 'genres', 'category', 'categories'];

/** For the right-click menu's link patterns; the same pages as looksLikeTagUrl. */
export const TAG_LINK_PATTERNS = [
  ...TAG_PATH_WORDS.map((w) => `*://*/*${w}/*`),
  '*://*/*_genre.php*', // JavLibrary: /en/vl_genre.php?g=…
];

const TAG_PATH = new RegExp(`(?:${TAG_PATH_WORDS.join('|')})/[^/]|_genre\\.php$`, 'i');

/** True if `url` looks like a tag page ("/categories/cheating-wife"). */
export function looksLikeTagUrl(url: string): boolean {
  const page = pageUrl(url);
  return !!page && TAG_PATH.test(new URL(page).pathname);
}

/** A tag's name from its page's address, for a link with no text: "/categories/cheating-wife" → "Cheating Wife". */
export function tagNameFromUrl(url: string): string | null {
  return nameAfterPathWord(url, TAG_PATH_WORDS);
}

/** A page as a tag stores it: without its #fragment, http(s) only, not too long. */
function tagPage(url: string): string | null {
  const page = pageUrl(url);
  return page && page.length <= MAX_PAGE_URL ? page : null;
}

/** The stored record: valid pages only, each once, the newest MAX_PAGES. */
export function makeTag(name: string, pages: string[], now: number): Tag {
  const valid = [...new Set(pages.map(tagPage).filter((p): p is string => !!p))];
  return { name, pages: valid.slice(-MAX_PAGES), added: now };
}

/** Where a tag opens: its pages, else a javtrailers search for its name. */
export function tagLinks(tag: Tag): string[] {
  return tag.pages.length ? tag.pages : [rawSearchUrl(tag.name)];
}

/** Tags from a dump of sync storage (other keys and malformed entries ignored), newest first. */
export function tagsFrom(dump: Record<string, unknown>): Tag[] {
  const list: Tag[] = [];
  for (const [key, value] of Object.entries(dump)) {
    if (!isTagKey(key) || !value || typeof value !== 'object') continue;
    const { name, pages, added } = value as Partial<Tag>;
    if (typeof name !== 'string' || !cleanName(name) || typeof added !== 'number') continue;
    const urls = Array.isArray(pages) ? pages.filter((p): p is string => typeof p === 'string') : [];
    list.push(makeTag(name, urls, added));
  }
  return list.sort((a, b) => b.added - a.added);
}

/** A page compared with a tag's pages: a trailing "/" doesn't count. */
const pageId = (page: string) => page.replace(/\/$/, '');

/**
 * A finder for the favourite tag a link stands for: the link goes to one of its saved pages, or it's a tag
 * link (looksLikeTagUrl) whose text, or else whose address, names it.
 */
export function tagFinder(tags: Tag[]): (linkUrl: string, linkText: string) => Tag | undefined {
  const byPage = new Map<string, Tag>();
  const byName = new Map<string, Tag>();
  for (const tag of tags) {
    tag.pages.forEach((p) => byPage.set(pageId(p), tag));
    byName.set(tagNameKey(tag.name), tag);
  }
  return (linkUrl, linkText) => {
    if (!tags.length) return undefined;
    const page = pageUrl(linkUrl);
    if (!page) return undefined;
    const saved = byPage.get(pageId(page));
    if (saved || !looksLikeTagUrl(page)) return saved;
    for (const name of [cleanName(linkText), tagNameFromUrl(page)]) {
      const tag = name ? byName.get(tagNameKey(name)) : undefined;
      if (tag) return tag;
    }
    return undefined;
  };
}

// --- chrome.storage.sync ---

export async function getTags(): Promise<Tag[]> {
  return tagsFrom(await chrome.storage.sync.get(null));
}

async function getTag(name: string): Promise<Tag | undefined> {
  const key = tagKey(name);
  return tagsFrom(await chrome.storage.sync.get(key))[0];
}

const noteUnstarred = (key: string) => chrome.storage.local.set({ [UNSTARRED_PREFIX + key]: Date.now() });

export type AddTagResult = 'added' | 'page-added' | 'exists' | 'invalid';

/**
 * Saves the tag `name` (see cleanName) with `page`, its tag page on some site. A tag that's saved already
 * gets the page added to its pages (so "NTR" gathers its pages from every site); its name stays.
 */
export async function addTag(name: string, page?: string | null, now = Date.now()): Promise<AddTagResult> {
  const clean = cleanName(name);
  if (!clean) return 'invalid';
  const url = page ? tagPage(page) : null;
  const existing = await getTag(clean);
  if (!existing) {
    await chrome.storage.sync.set({ [tagKey(clean)]: makeTag(clean, url ? [url] : [], now) });
    return 'added';
  }
  if (!url || existing.pages.includes(url)) return 'exists';
  await chrome.storage.sync.set({ [tagKey(clean)]: makeTag(existing.name, [...existing.pages, url], existing.added) });
  return 'page-added';
}

export async function removeTag(name: string): Promise<void> {
  const key = tagKey(name);
  await chrome.storage.sync.remove(key);
  await noteUnstarred(key); // so its bookmarks in the backup can go (see fav-backup.ts)
}

/** Takes one page off a tag (the tag stays, even with no pages left). */
export async function removeTagPage(name: string, page: string): Promise<void> {
  const tag = await getTag(name);
  if (!tag) return;
  await chrome.storage.sync.set({ [tagKey(name)]: { ...tag, pages: tag.pages.filter((p) => p !== page) } });
  await noteUnstarred(tagPageKey(name, page));
}

/** Calls `callback` whenever a tag is saved, changed or removed, on this device or another. */
export function onTagsChanged(callback: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(isTagKey)) callback();
  });
}
