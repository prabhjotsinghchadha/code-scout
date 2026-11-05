import { parseCode, rawSearchUrl, trailerUrl, type VideoCode } from '../shared/codes';
import type { Message } from '../shared/messages';
import { defaultSettings, getSettings } from '../shared/storage';

const MENU_SELECTION = 'open-trailer-selection';
const MENU_LINK = 'open-trailer-link';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.sync.set(defaultSettings);
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: 'Open trailer for “%s”',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: 'Open trailer for this link',
      contexts: ['link'],
    });
  });
});

async function openUrl(url: string, sourceTab?: chrome.tabs.Tab) {
  const { openInBackground } = await getSettings();
  await chrome.tabs.create({
    url,
    active: !openInBackground,
    ...(sourceTab?.id !== undefined && {
      index: sourceTab.index + 1,
      openerTabId: sourceTab.id,
      windowId: sourceTab.windowId,
    }),
  });
}

async function openCode(code: VideoCode, sourceTab?: chrome.tabs.Tab) {
  const { openMode } = await getSettings();
  await openUrl(trailerUrl(code, openMode), sourceTab);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    const code = parseCode(info.selectionText);
    // Not a recognizable code: fall back to searching the raw selection.
    void (code ? openCode(code, tab) : openUrl(rawSearchUrl(info.selectionText), tab));
  } else if (info.menuItemId === MENU_LINK && info.linkUrl) {
    // Link text isn't available here, so look for a code in the link's URL.
    const code = parseCode(decodeURIComponent(info.linkUrl));
    if (code) void openCode(code, tab);
  }
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === 'OPEN_CODE') {
    void (async () => {
      // From the popup there's no sender tab; open next to the active tab instead.
      const [active] = sender.tab ? [sender.tab] : await chrome.tabs.query({ active: true, currentWindow: true });
      await openCode(message.code, active);
      sendResponse({ ok: true });
    })();
    return true; // keep the channel open for the async response
  }
  return false;
});
