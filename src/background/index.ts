import type { Message } from '../shared/messages';
import { defaultSettings } from '../shared/storage';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.sync.set(defaultSettings);
  }
  console.log('[background] installed:', reason);
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'PING':
      sendResponse({ ok: true, from: 'background' });
      break;
  }
  // Return true only if you call sendResponse asynchronously.
  return false;
});
