// Favourites on web pages: which codes are starred (for the ★ buttons, chip and menu), and starring one
// together with the page it's shown on.
import { codeInUrl, findCodes, formatCode, type VideoCode } from '../shared/codes';
import {
  favouriteCodes,
  favouriteError,
  onFavouritesChanged,
  toggleFavourite,
  type FavouritePage,
} from '../shared/favourites';
import type { Editable } from './editable';

let starred = new Set<string>();
const listeners = new Set<() => void>();

export function isStarred(code: VideoCode): boolean {
  return starred.has(formatCode(code));
}

/** Calls `callback` after the starred set changes (on this or another device). */
export function onStarredChange(callback: () => void): void {
  listeners.add(callback);
}

let started: Promise<void> | null = null;
/** Loads the starred codes and keeps them current. Safe to call more than once. */
export function startFavourites(): Promise<void> {
  const refresh = async () => {
    starred = await favouriteCodes();
    listeners.forEach((l) => l());
  };
  started ??= refresh().then(() => onFavouritesChanged(() => void refresh()));
  return started;
}

/** This page, to save with a favourite. */
export function thisPage(): FavouritePage {
  return { url: location.href, title: document.title };
}

const count = (text: string, code: string) => findCodes(text).filter((m) => formatCode(m.code) === code).length;

/**
 * True if `code` is this page's video (its address is "/videos/MD0273") or is shown on the page, not only
 * typed into `field` (whose text is part of the page's text when it's a rich-text editor). A code that is
 * only typed gets no page: it's probably a search box, not the video.
 */
export function shownOnPage(code: VideoCode, field?: Editable): boolean {
  const c = formatCode(code);
  const fromUrl = codeInUrl(location.href);
  if (fromUrl && formatCode(fromUrl) === c) return true;
  const inField = field?.isContentEditable ? count(field.innerText, c) : 0;
  return count(document.body.innerText, c) > inField;
}

/** Star or un-star; `page` is saved when starring. Shows why if it couldn't be saved. */
export async function toggleStar(code: VideoCode, page: FavouritePage | null): Promise<void> {
  try {
    await toggleFavourite(code, page);
  } catch (err) {
    alert(`${chrome.runtime.getManifest().name}: ${favouriteError(err)}`);
  }
}
