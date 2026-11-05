// Typed messages passed between popup, background and content scripts.
export type Message =
  | { type: 'PING' }
  | { type: 'GET_PAGE_INFO' };

export type MessageResponse<T extends Message['type']> = T extends 'PING'
  ? { ok: true; from: 'background' }
  : T extends 'GET_PAGE_INFO'
    ? { title: string; url: string }
    : never;

export function sendToBackground<M extends Message>(message: M): Promise<MessageResponse<M['type']>> {
  return chrome.runtime.sendMessage(message);
}

export function sendToTab<M extends Message>(tabId: number, message: M): Promise<MessageResponse<M['type']>> {
  return chrome.tabs.sendMessage(tabId, message);
}
