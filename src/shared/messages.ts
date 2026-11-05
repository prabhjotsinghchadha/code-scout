// Typed messages passed between popup, background and content scripts.
import type { VideoCode } from './codes';

export type Message =
  | { type: 'OPEN_CODE'; code: VideoCode }
  | { type: 'GET_PAGE_CODES' };

export interface MessageResponses {
  OPEN_CODE: { ok: true };
  GET_PAGE_CODES: { codes: VideoCode[] };
}

export function sendToBackground<M extends Message>(message: M): Promise<MessageResponses[M['type']]> {
  return chrome.runtime.sendMessage(message);
}

export function sendToTab<M extends Message>(tabId: number, message: M): Promise<MessageResponses[M['type']]> {
  return chrome.tabs.sendMessage(tabId, message);
}
