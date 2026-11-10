// What a site's search lists for some text (see shared/web-search.ts), for the popup to show as rows.
// Only asked for when the user presses "Search … for" in the popup: nothing is read while they type.
import type { WebSearchResult } from '../shared/messages';
import { isSearchSource, parseWebSearch, sourceName, webSearchUrl, type SearchSource } from '../shared/web-search';

/** Answers kept for a while, so the same search (or going back to it) is instant. */
const CACHE_MS = 10 * 60_000;
const MAX_CACHED = 30;
const TIMEOUT_MS = 10_000;

const cache = new Map<string, { at: number; result: Promise<WebSearchResult> }>();

async function search(source: SearchSource, text: string): Promise<WebSearchResult> {
  const site = sourceName(source);
  try {
    // With the browser's cookies, as when the site is opened in a tab (it may have checked this browser).
    const response = await fetch(webSearchUrl(source, text), { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 403 || response.status === 503) {
      return { error: `${site} didn’t answer. Open its search page once (it may check your browser), then try again.` };
    }
    // Jav Guru answers "not found" for a search with no posts.
    if (response.status === 404) return { results: [] };
    if (!response.ok) return { error: `${site} answered ${response.status}.` };
    return { results: parseWebSearch(source, await response.text()) };
  } catch (err) {
    console.warn(`Searching ${site} failed:`, err);
    return { error: `Couldn’t reach ${site}. Try again in a moment.` };
  }
}

export function webSearch(source: unknown, rawText: unknown): Promise<WebSearchResult> {
  const text = String(rawText ?? '').trim().slice(0, 100);
  if (!isSearchSource(source) || !text) return Promise.resolve({ error: 'Nothing to search for.' });
  const key = `${source}\n${text.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const result = search(source, text);
  cache.delete(key);
  cache.set(key, { at: Date.now(), result });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  // A failed search is tried again next time.
  void result.then((r) => 'error' in r && cache.delete(key));
  return result;
}
