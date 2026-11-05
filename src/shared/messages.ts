// Typed messages passed between popup, background and content scripts.
import type { OpenMode, VideoCode } from './codes';

export type Message =
  /** Open a code; `mode` overrides the "Open" setting (e.g. 'search' for the Search buttons). */
  | { type: 'OPEN_CODE'; code: VideoCode; mode?: OpenMode }
  | { type: 'GET_PAGE_CODES' }
  /** The code the user has selected, or is typing in the focused field. */
  | { type: 'GET_ACTIVE_CODE' }
  /** Open web URLs in new tabs next to the sender (first one focused unless background tabs are on). */
  | { type: 'OPEN_URLS'; urls: string[] }
  | { type: 'OPEN_OPTIONS' };

export interface MessageResponses {
  OPEN_CODE: { ok: true };
  GET_PAGE_CODES: { codes: VideoCode[] };
  GET_ACTIVE_CODE: { code: VideoCode | null; text: string };
  OPEN_URLS: { ok: true };
  OPEN_OPTIONS: { ok: true };
}

export function sendToBackground<M extends Message>(message: M): Promise<MessageResponses[M['type']]> {
  return chrome.runtime.sendMessage(message);
}

export function sendToTab<M extends Message>(tabId: number, message: M): Promise<MessageResponses[M['type']]> {
  return chrome.tabs.sendMessage(tabId, message);
}
