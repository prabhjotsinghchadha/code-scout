// Typed messages passed between popup, background and content scripts.
import type { OpenMode, VideoCode } from './codes';
import type { OcrLine } from './subtitles';
import type { SubtitleLang } from './translator';

export type Message =
  /** Open a code; `mode` overrides the "Open" setting (e.g. 'search' for the Search buttons). */
  | { type: 'OPEN_CODE'; code: VideoCode; mode?: OpenMode }
  | { type: 'GET_PAGE_CODES' }
  /** The code the user has selected, or is typing in the focused field. */
  | { type: 'GET_ACTIVE_CODE' }
  /** The link the user last right-clicked on the page (for "Add this actress to favourites"). */
  | { type: 'GET_CONTEXT_LINK' }
  /** Open web URLs in new tabs next to the sender (first one focused unless background tabs are on). */
  | { type: 'OPEN_URLS'; urls: string[] }
  | { type: 'OPEN_OPTIONS' }
  /** Pop-up blocker: the user is about to open a new tab themselves (Ctrl/middle-click, a same-site link). */
  | { type: 'ALLOW_NEW_TAB'; ms: number }
  /** Pop-up blocker: something was blocked on the sender's page (counted on the toolbar badge). */
  | { type: 'POPUP_BLOCKED' }
  /** Video tools: read the text in a subtitle strip (a JPEG data URL). The background passes it to the
   * offscreen document, which runs the OCR model. */
  | { type: 'OCR_STRIP'; image: string }
  /** Video tools: translate a subtitle line to English in the offscreen document (used when the page's
   * content script has no Translator API). */
  | { type: 'TRANSLATE'; text: string; from: SubtitleLang };

export interface MessageResponses {
  OPEN_CODE: { ok: true };
  GET_PAGE_CODES: { codes: VideoCode[] };
  GET_ACTIVE_CODE: { code: VideoCode | null; text: string };
  GET_CONTEXT_LINK: ContextLink | null;
  OPEN_URLS: { ok: true };
  OPEN_OPTIONS: { ok: true };
  ALLOW_NEW_TAB: { ok: true };
  POPUP_BLOCKED: { ok: true };
  OCR_STRIP: OcrResult;
  TRANSLATE: TranslateResult;
}

/** A link on a page: its address and its text (or its image's alt text). */
export interface ContextLink {
  url: string;
  text: string;
}

export type OcrResult = { lines: OcrLine[] } | { error: string };
export type TranslateResult = { text: string } | { error: string };

/** Background → offscreen document (only it handles these). */
export type OffscreenMessage =
  | { target: 'offscreen'; type: 'OCR'; image: string }
  | { target: 'offscreen'; type: 'TRANSLATE'; text: string; from: SubtitleLang };

export function sendToBackground<M extends Message>(message: M): Promise<MessageResponses[M['type']]> {
  return chrome.runtime.sendMessage(message);
}

/** `frameId`: only that frame of the tab (e.g. the one that was right-clicked), not every frame. */
export function sendToTab<M extends Message>(tabId: number, message: M, frameId?: number): Promise<MessageResponses[M['type']]> {
  return frameId === undefined ? chrome.tabs.sendMessage(tabId, message) : chrome.tabs.sendMessage(tabId, message, { frameId });
}
