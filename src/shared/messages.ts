// Typed messages passed between popup, background and content scripts.
import type { OpenMode, VideoCode } from './codes';
import type { FoundSubtitle } from './subtitle-cat';
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
  /**
   * Open web URLs in new tabs next to the sender (first one focused unless background tabs are on). `code`:
   * the code they open (e.g. on "Open on" sites), noted as seen.
   */
  | { type: 'OPEN_URLS'; urls: string[]; code?: VideoCode }
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
  | { type: 'TRANSLATE'; text: string; from: SubtitleLang }
  /** Video tools in a frame from another site (an embedded player, see frame-bridge.ts): the tab's address and title. */
  | { type: 'TAB_PAGE' }
  /** …translate a line in the tab's top page, which may use Chrome's translator (the frame may not). */
  | { type: 'TRANSLATE_IN_PAGE'; text: string; from: SubtitleLang }
  /** …show "Save as" in the tab's top page (the frame may not); the page then writes what the frame sends. */
  | { type: 'SAVE_IN_PAGE'; name: string }
  /** Video tools, CC menu: subtitle files for a code, from SubtitleCat (background/subtitle-search.ts). */
  | { type: 'FIND_SUBTITLES'; code: VideoCode }
  /** …the text of one of them (a SubtitleCat file URL from FIND_SUBTITLES). */
  | { type: 'GET_SUBTITLE_FILE'; url: string }
  /** Pop-up blocker in a frame from another site: also run its page-side script here (if it's on for the tab's site). */
  | { type: 'BLOCK_POPUPS_IN_FRAME' }
  /** Background → the tab's top page: TRANSLATE_IN_PAGE and SAVE_IN_PAGE for one of its frames. */
  | { type: 'PAGE_TRANSLATE'; text: string; from: SubtitleLang }
  | { type: 'PAGE_SAVE'; token: string; name: string };

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
  TAB_PAGE: { url: string; title: string };
  TRANSLATE_IN_PAGE: TranslateResult;
  SAVE_IN_PAGE: SaveAnswer;
  FIND_SUBTITLES: FindSubtitlesResult;
  GET_SUBTITLE_FILE: SubtitleFileResult;
  BLOCK_POPUPS_IN_FRAME: { ok: true };
  PAGE_TRANSLATE: TranslateResult;
  PAGE_SAVE: SaveAnswer;
}

/** A link on a page: its address and its text (or its image's alt text). */
export interface ContextLink {
  url: string;
  text: string;
  /** Text of the card the link is in (a thumbnail's title beside it), if any. */
  around?: string;
}

export type OcrResult = { lines: OcrLine[] } | { error: string };
export type TranslateResult = { text: string } | { error: string };
/** A subtitle file found for a code: SubtitleCat's listing, plus the file to show and whether it's English. */
export interface SubtitleChoice extends FoundSubtitle {
  fileUrl: string;
  english: boolean;
}
export type FindSubtitlesResult = { choices: SubtitleChoice[] } | { error: string };
export type SubtitleFileResult = { text: string } | { error: string };
/** The top page's "Save as" for a frame: the file's name, with the token that pairs the frame's channel to it. */
export type SaveAnswer = { name: string; token: string } | { cancelled: true } | { error: string };

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
