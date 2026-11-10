// Searching a site from the popup: what its search page lists for some text, as rows to pick from. Read
// only when the user asks (the popup's "Search … for" row), by the background (background/web-search.ts).
// The parsers work on the page's HTML as text: the background has no DOM.
import { codeInUrl, findCodes, parseCode, rawSearchUrl, type VideoCode } from './codes.ts';
import { htmlText } from './details.ts';

export type SearchSource = 'javtrailers' | 'javguru';

export const SEARCH_SOURCES: readonly { id: SearchSource; name: string; about: string }[] = [
  { id: 'javtrailers', name: 'javtrailers', about: 'Trailers and details for every release' },
  { id: 'javguru', name: 'Jav Guru', about: 'Full videos to stream' },
];

export const isSearchSource = (value: unknown): value is SearchSource => SEARCH_SOURCES.some((s) => s.id === value);
export const sourceName = (source: SearchSource): string => SEARCH_SOURCES.find((s) => s.id === source)!.name;

/** One video a search found. */
export interface WebResult {
  /** Its page on the site searched. */
  url: string;
  title: string;
  /** Its code, when the site says it. */
  code?: VideoCode;
  /** A small cover picture's address. */
  cover?: string;
  /** Its release date, as the site writes it ("25 Dec 2013"). */
  note?: string;
}

/** The most rows kept from one search page. */
export const MAX_RESULTS = 30;
const MAX_TEXT = 300;
const JAVTRAILERS = 'https://javtrailers.com';
const JAVGURU = 'https://jav.guru';

/** The site's own search page for `text`: what's read, and what "open the search page" opens. */
export function webSearchUrl(source: SearchSource, text: string): string {
  return source === 'javguru' ? `${JAVGURU}/?s=${encodeURIComponent(text.trim())}` : rawSearchUrl(text);
}

const picture = (url: string | undefined) => (url && /^https:\/\/[^\s"<>]+$/.test(url) && url.length < 600 ? url : undefined);
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];

function add(out: Map<string, WebResult>, result: WebResult, cover: string | undefined, note = '') {
  if (!result.title || out.has(result.url) || out.size >= MAX_RESULTS) return;
  if (picture(cover)) result.cover = cover;
  if (note) result.note = note.slice(0, 40);
  out.set(result.url, result);
}

/**
 * javtrailers' search page: a card per video, a link to "/video/<id>" with the title in its `title`, the
 * cover in a lazy <img> whose alt is "WIFE-53 jav", and the date in a <small>.
 */
export function parseJavtrailersSearch(html: string): WebResult[] {
  const out = new Map<string, WebResult>();
  for (const m of html.matchAll(/(<a\b[^>]*\shref="\/video\/([\w-]+)"[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const [, open, id, body] = m;
    const url = `${JAVTRAILERS}/video/${id}`;
    const img = body.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const code = parseCode(htmlText(attr(img, 'alt') ?? '').replace(/\s+jav$/i, '')) ?? codeInUrl(url);
    // The card's own line is "WIFE-53 9 to 5 Married Woman…": the link's title is that without the code.
    const line = htmlText(body.match(/<p\b[^>]*vid-title[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
    const title = (htmlText(attr(open, 'title') ?? '') || line).slice(0, MAX_TEXT);
    const result: WebResult = { url, title };
    if (code) result.code = code;
    add(out, result, attr(img, 'data-src') ?? attr(img, 'src'), htmlText(body.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? ''));
  }
  return [...out.values()];
}

/**
 * Jav Guru's search page: a card per post ("inside-article"), a link to "/<number>/<slug>/" around the
 * cover, then the title, which starts with the code in brackets: "[VEC-443] The wife next door…".
 */
export function parseJavGuruSearch(html: string): WebResult[] {
  const out = new Map<string, WebResult>();
  for (const card of html.split(/<div class="inside-article">/i).slice(1)) {
    const url = card.match(/<a\b[^>]*\shref="(https:\/\/jav\.guru\/\d+\/[^"\s<>]+)"/i)?.[1];
    if (!url || url.length > 600) continue;
    const img = card.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const heading = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const full = htmlText(heading ?? attr(img, 'alt') ?? '');
    const bracket = full.match(/^\[([^\]]{2,30})\]\s*/);
    // Only a code the site writes as one: in the brackets, or hyphenated in capitals in the title.
    const code = (bracket && parseCode(bracket[1])) || findCodes(full)[0]?.code;
    // A code in the brackets is shown on its own; anything else in them ("P-2997") stays in the title.
    const title = (bracket && code ? full.slice(bracket[0].length) || full : full).slice(0, MAX_TEXT);
    const result: WebResult = { url, title };
    if (code) result.code = code;
    add(out, result, attr(img, 'src') ?? attr(img, 'data-src'));
  }
  return [...out.values()];
}

export function parseWebSearch(source: SearchSource, html: string): WebResult[] {
  return source === 'javguru' ? parseJavGuruSearch(html) : parseJavtrailersSearch(html);
}
