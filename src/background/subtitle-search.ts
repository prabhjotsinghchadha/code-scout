// Subtitle files for a video code, from SubtitleCat (see shared/subtitle-cat.ts). Content scripts can't
// read another site's pages themselves, so the video toolbar's CC menu asks the background:
//   FIND_SUBTITLES     → the files listed for the code, each with the file to show (English if there is one)
//   GET_SUBTITLE_FILE  → that file's text
import { formatCode, type VideoCode } from '../shared/codes';
import type { FindSubtitlesResult, SubtitleChoice, SubtitleFileResult } from '../shared/messages';
import { decodeSubtitleFile } from '../shared/srt';
import { bestFile, parseSubtitleCatPage, parseSubtitleCatSearch, SUBTITLECAT, subtitleCatSearchUrl } from '../shared/subtitle-cat';

/** Subtitle pages read for one search (each says whether there's an English file). */
const MAX_PAGES = 8;
/** Answers kept for a while, so opening the menu again (or another video of the code) is instant. */
const CACHE_MS = 30 * 60_000;
const TIMEOUT_MS = 20_000;

const cache = new Map<string, { at: number; result: Promise<FindSubtitlesResult> }>();

async function get(url: string): Promise<Response> {
  // With the browser's cookies, as when the site is opened in a tab (it may have checked this browser).
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    if (response.status === 403 || response.status === 503) {
      throw new Error('SubtitleCat didn’t answer. Open subtitlecat.com in a tab once (it may check your browser), then try again.');
    }
    throw new Error(`SubtitleCat answered ${response.status}.`);
  }
  return response;
}

async function search(code: VideoCode): Promise<FindSubtitlesResult> {
  try {
    const found = parseSubtitleCatSearch(await (await get(subtitleCatSearchUrl(code))).text(), code).slice(0, MAX_PAGES);
    const choices = await Promise.all(
      found.map(async (item): Promise<SubtitleChoice | null> => {
        const files = parseSubtitleCatPage(await (await get(item.pageUrl)).text(), item.pageUrl);
        const fileUrl = bestFile(files, item.from);
        return fileUrl ? { ...item, fileUrl, english: fileUrl === files.english } : null;
      }).map((p) => p.catch(() => null)),
    );
    const usable = choices.filter((c): c is SubtitleChoice => !!c);
    // English ones first (no translating needed), keeping SubtitleCat's best-first order otherwise.
    return { choices: [...usable.filter((c) => c.english), ...usable.filter((c) => !c.english)] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function findSubtitles(code: VideoCode): Promise<FindSubtitlesResult> {
  const key = formatCode(code);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const result = search(code);
  cache.set(key, { at: Date.now(), result });
  // A failed search is tried again next time.
  void result.then((r) => 'error' in r && cache.delete(key));
  return result;
}

export async function getSubtitleFile(url: string): Promise<SubtitleFileResult> {
  try {
    // Only SubtitleCat's files: this isn't a way for pages to fetch whatever they like.
    if (new URL(url).origin !== SUBTITLECAT) return { error: 'Not a SubtitleCat file.' };
    const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
    return { text: decodeSubtitleFile(bytes) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
