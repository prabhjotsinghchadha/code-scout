import type { Message } from '../shared/messages';
import { getSettings } from '../shared/storage';

async function init() {
  const { enabled } = await getSettings();
  if (!enabled) return;
  console.log('[content] loaded on', location.href);
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_INFO') {
    sendResponse({ title: document.title, url: location.href });
  }
  return false;
});

void init();
