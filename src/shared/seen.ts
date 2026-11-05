// Codes already seen: opened from the extension, or visited on a page whose address is the code
// ("/videos/MD0273"). Kept in chrome.storage.local, on this computer only (sync's 512 keys are the
// favourites'), so the ▶ buttons can mark them and the popup can list them under Recent.
import { codeInUrl, formatCode, parseCode, type VideoCode } from './codes.ts';
import { isWebUrl } from './open-on.ts';

export interface SeenEntry {
  /** When it was last opened or visited (ms since epoch). */
  at: number;
  /** The video page it was last visited on. Not set for codes only ever opened from the extension. */
  url?: string;
  title?: string;
}

/** "NSFS-484" → when it was last seen. */
export type Seen = Record<string, SeenEntry>;

export type SeenCode = SeenEntry & { code: VideoCode };

/** The page a code was seen on. */
export interface SeenPage {
  url: string;
  title?: string;
}

export const SEEN_KEY = 'seenCodes';
/** The most remembered; past this, the ones seen longest ago are forgotten. */
export const MAX_SEEN = 2000;
const MAX_TITLE = 100;
const MAX_URL = 2048;

/**
 * The code a page is the video page of: its address ends in the code ("/videos/MD0273", "/en/nsfs-484"). Not
 * a search page ("/search/nsfs-484"): searching for a code isn't seeing it.
 */
export function videoPageCode(url: string): VideoCode | null {
  try {
    if (new URL(url).pathname.split('/').some((part) => /^search/i.test(part))) return null;
  } catch {
    return null;
  }
  return codeInUrl(url);
}

/**
 * The page to keep with a code seen on `url`. None on javtrailers.com: its trailer page is one click away
 * anyway (Open), so the video page last visited on another site is kept instead.
 */
export function seenPage(url: string, title?: string): SeenPage | null {
  try {
    if (/(^|\.)javtrailers\.com$/.test(new URL(url).hostname)) return null;
  } catch {
    return null;
  }
  return { url, title };
}

/** When `code` was last seen, if it was. */
export function seenEntry(seen: Seen, code: VideoCode): SeenEntry | undefined {
  return seen[formatCode(code)];
}

/**
 * Notes `code` as seen at `now`, on `page` if given (opening from the extension has no page: the page it
 * was last visited on is kept then). Forgets the oldest past `max`.
 */
export function addSeen(seen: Seen, code: VideoCode, now: number, page?: SeenPage | null, max = MAX_SEEN): Seen {
  const key = formatCode(code);
  const entry: SeenEntry = { ...seen[key], at: now };
  if (page && isWebUrl(page.url) && page.url.length <= MAX_URL) {
    entry.url = page.url;
    const title = page.title?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (title) entry.title = title;
    else delete entry.title;
  }
  const next: Seen = { ...seen, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  const keep = new Set(keys.sort((a, b) => next[b].at - next[a].at).slice(0, max));
  return Object.fromEntries(Object.entries(next).filter(([k]) => keep.has(k)));
}

export function forgetSeen(seen: Seen, code: VideoCode): Seen {
  const { [formatCode(code)]: _, ...rest } = seen;
  return rest;
}

/** Seen codes, the most recent first; at most `n`. */
export function recentSeen(seen: Seen, n = Infinity): SeenCode[] {
  const list: SeenCode[] = [];
  for (const [key, entry] of Object.entries(seen)) {
    const code = parseCode(key);
    if (code) list.push({ ...entry, code });
  }
  return list.sort((a, b) => b.at - a.at).slice(0, n);
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", "2 weeks ago", "3 months ago". */
export function seenAgo(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
}

// --- Storage (the background is the only writer, apart from forgetting one or all) ---

export async function getSeen(): Promise<Seen> {
  const stored = await chrome.storage.local.get<{ [SEEN_KEY]: Seen }>({ [SEEN_KEY]: {} });
  return stored[SEEN_KEY];
}

export function onSeenChanged(callback: (seen: Seen) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SEEN_KEY]) callback((changes[SEEN_KEY].newValue as Seen | undefined) ?? {});
  });
}

let writing = Promise.resolve();
/** Changes the stored list; one change at a time, so codes seen in two tabs at once are both kept. */
function update(change: (seen: Seen) => Seen): Promise<void> {
  writing = writing
    .then(async () => {
      await chrome.storage.local.set({ [SEEN_KEY]: change(await getSeen()) });
    })
    .catch((err) => console.warn('Updating seen codes failed', err));
  return writing;
}

export function recordSeen(code: VideoCode, page?: SeenPage | null): Promise<void> {
  return update((seen) => addSeen(seen, code, Date.now(), page));
}

export function forgetSeenCode(code: VideoCode): Promise<void> {
  return update((seen) => forgetSeen(seen, code));
}

export async function clearSeen(): Promise<void> {
  await chrome.storage.local.remove(SEEN_KEY);
}
