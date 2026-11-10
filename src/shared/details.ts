// What a code is: its title, cover, performers, studio, series, genres, date and length, read from the
// video's page on javtrailers.com. Read only when asked for (a row expanded or a code starred in the popup,
// or a trailer page the user is on), then kept in chrome.storage.local so lists can say what their codes
// are. parseDetails works on the page's HTML as text: the background has no DOM.
import { formatCode, parseCode, type VideoCode } from './codes.ts';

/** A performer, studio, series or genre: its name and its page on javtrailers. */
export interface Named {
  name: string;
  url: string;
}

export interface VideoDetails {
  title: string;
  /** The cover picture's address. */
  cover?: string;
  cast: Named[];
  studio?: Named;
  series?: Named;
  genres: Named[];
  /** As the site writes it: "06 Jun 2026". */
  released?: string;
  minutes?: number;
  /** The video's page. */
  url: string;
  /** When it was read (ms since epoch); the oldest are dropped first. */
  at: number;
}

/** "NSFS-484" → its details. */
export type DetailsCache = Record<string, VideoDetails>;

export const DETAILS_KEY = 'videoDetails';
/** The most kept; past this, the ones read longest ago go. */
export const MAX_DETAILS = 400;
const SITE = 'https://javtrailers.com';
const MAX_TEXT = 300;
const MAX_LIST = 40;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text of a piece of HTML: no tags or comments, entities as characters, spaces tidied. */
export function htmlText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** What follows a label on the page ("Studio:", "Cast(s):"), as HTML: the rest of its paragraph. */
function field(html: string, label: string): string | null {
  const escaped = label.replace(/[()]/g, '\\$&');
  return html.match(new RegExp(`<span[^>]*>\\s*${escaped}\\s*:?\\s*</span>([\\s\\S]*?)</p>`, 'i'))?.[1] ?? null;
}

/** The links in a piece of the page that go to `/kind/…`, as names and addresses on the site. */
function links(html: string | null, kind: string): Named[] {
  const out: Named[] = [];
  for (const m of (html ?? '').matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = htmlText(m[2]).slice(0, MAX_TEXT);
    if (name && m[1].startsWith(`/${kind}/`) && out.length < MAX_LIST) out.push({ name, url: SITE + m[1] });
  }
  return out;
}

/**
 * A performer's name as the site lists it is "Miu Aona 碧那美海": the name in English, then in Japanese.
 * This is the English part (all of it when there's no Japanese), the one to save and search by.
 */
export function englishName(name: string): string {
  const english = name.replace(/[\s　]*[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ][\s\S]*$/, '').trim();
  return english || name.trim();
}

/**
 * The details on a javtrailers video page (its HTML, or the parts of it a content script sends: the
 * heading, the cover's <meta> and the labelled paragraphs). Null when it isn't a video page.
 */
export function parseDetails(html: string, url: string, now: number): VideoDetails | null {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading || field(html, 'DVD ID') === null) return null;
  const id = htmlText(field(html, 'DVD ID')!);
  let title = htmlText(heading[1]);
  // The heading starts with the code; the title is the rest.
  if (id && title.toUpperCase().startsWith(id.toUpperCase())) title = title.slice(id.length).trim();
  if (!title) return null;

  const details: VideoDetails = {
    title: title.slice(0, MAX_TEXT),
    cast: links(field(html, 'Cast(s)') ?? field(html, 'Cast'), 'casts'),
    genres: links(field(html, 'Categories'), 'categories'),
    url,
    at: now,
  };
  const cover = html.match(/<meta[^>]*property="og:image"[^>]*content="(https:\/\/[^"]+)"/i)?.[1];
  if (cover) details.cover = cover;
  const [studio] = links(field(html, 'Studio'), 'studios');
  if (studio) details.studio = studio;
  const [series] = links(field(html, 'Series'), 'series');
  if (series) details.series = series;
  const released = htmlText(field(html, 'Release Date') ?? '');
  if (released) details.released = released.slice(0, 40);
  const minutes = parseInt(htmlText(field(html, 'Duration') ?? ''), 10);
  if (minutes > 0 && minutes < 2000) details.minutes = minutes;
  return details;
}

/** The code a video page is about (its "DVD ID"), if it says. */
export function pageCode(html: string): VideoCode | null {
  const id = field(html, 'DVD ID');
  return id === null ? null : parseCode(htmlText(id));
}

/** The parts of a video page that parseDetails reads, for a content script to send instead of the whole page. */
export const DETAILS_PARTS = 'h1, meta[property="og:image"], p.mb-1';

const isWeb = (value: unknown): value is string => typeof value === 'string' && /^https:\/\/[^\s"<>]+$/.test(value) && value.length < 600;
const named = (value: unknown): Named | null => {
  const v = value as Partial<Named> | null;
  return v && typeof v.name === 'string' && v.name.trim() && isWeb(v.url) ? { name: v.name.trim().slice(0, MAX_TEXT), url: v.url } : null;
};
const namedList = (value: unknown): Named[] => (Array.isArray(value) ? value.flatMap((v) => named(v) ?? []).slice(0, MAX_LIST) : []);

/** Stored or imported details, checked entry by entry: only well-formed ones under a code's own name. */
export function detailsFrom(value: unknown): DetailsCache {
  const out: DetailsCache = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const code = parseCode(key);
    const v = raw as Partial<VideoDetails> | null;
    if (!code || formatCode(code) !== key || !v || typeof v !== 'object') continue;
    if (typeof v.title !== 'string' || !v.title.trim() || !isWeb(v.url)) continue;
    const entry: VideoDetails = {
      title: v.title.trim().slice(0, MAX_TEXT),
      cast: namedList(v.cast),
      genres: namedList(v.genres),
      url: v.url,
      at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
    };
    if (isWeb(v.cover)) entry.cover = v.cover;
    const studio = named(v.studio);
    if (studio) entry.studio = studio;
    const series = named(v.series);
    if (series) entry.series = series;
    if (typeof v.released === 'string' && v.released.trim()) entry.released = v.released.trim().slice(0, 40);
    if (typeof v.minutes === 'number' && v.minutes > 0 && v.minutes < 2000) entry.minutes = Math.round(v.minutes);
    out[key] = entry;
  }
  return out;
}

/** The cache with `code`'s details added; past `max`, the ones read longest ago are dropped. */
export function addDetails(cache: DetailsCache, code: VideoCode, details: VideoDetails, max = MAX_DETAILS): DetailsCache {
  const next: DetailsCache = { ...cache, [formatCode(code)]: details };
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  const keep = new Set(keys.sort((a, b) => next[b].at - next[a].at).slice(0, max));
  return Object.fromEntries(Object.entries(next).filter(([k]) => keep.has(k)));
}

/** Two caches as one: for a code in both, the details read later. */
export function mergeDetails(a: DetailsCache, b: DetailsCache, max = MAX_DETAILS): DetailsCache {
  const all: DetailsCache = { ...a };
  for (const [key, entry] of Object.entries(b)) if (!all[key] || entry.at > all[key].at) all[key] = entry;
  const keep = Object.keys(all)
    .sort((x, y) => all[y].at - all[x].at)
    .slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, all[k]]));
}

/** One line for a list: "Miu Aona · Nagae Style" (performers, at most two and "+n", then the studio). */
export function detailsLine(d: VideoDetails): string {
  const names = d.cast.map((c) => englishName(c.name));
  const cast = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return [cast, d.studio?.name].filter(Boolean).join(' · ');
}

// --- Storage (the background is the only writer) ---

export async function getDetailsCache(): Promise<DetailsCache> {
  const stored = await chrome.storage.local.get<{ [DETAILS_KEY]: unknown }>({ [DETAILS_KEY]: {} });
  return detailsFrom(stored[DETAILS_KEY]);
}

export function onDetailsChanged(callback: (cache: DetailsCache) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[DETAILS_KEY]) callback(detailsFrom(changes[DETAILS_KEY].newValue));
  });
}

let writing = Promise.resolve();
/** Adds one code's details; one write at a time, so two codes read at once are both kept. */
export function saveDetails(code: VideoCode, details: VideoDetails): Promise<void> {
  writing = writing
    .then(async () => {
      await chrome.storage.local.set({ [DETAILS_KEY]: addDetails(await getDetailsCache(), code, details) });
    })
    .catch((err) => console.warn('Saving video details failed', err));
  return writing;
}

export async function clearDetails(): Promise<void> {
  await chrome.storage.local.remove(DETAILS_KEY);
}
