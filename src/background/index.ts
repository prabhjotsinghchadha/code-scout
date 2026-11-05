import { parseCode, rawSearchUrl, trailerUrl, type OpenMode, type VideoCode } from '../shared/codes';
import { sendToTab, type Message } from '../shared/messages';
import { defaultSettings, getSettings, seedQuickLinks } from '../shared/storage';

const MENU_OPEN = 'open-trailer-selection';
const MENU_SEARCH = 'search-trailer-selection';
const MENU_LINK = 'open-trailer-link';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.sync.set(defaultSettings);
  }
  await seedQuickLinks();
  chrome.contextMenus.removeAll(() => {
    // "selection" also covers text selected inside inputs and textareas.
    chrome.contextMenus.create({ id: MENU_OPEN, title: 'Open trailer for “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_SEARCH, title: 'Search javtrailers for “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_LINK, title: 'Open trailer for this link', contexts: ['link'] });
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

/** `mode` overrides the "Open" setting; omit it to use the setting. */
async function openCode(code: VideoCode, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const { openMode } = await getSettings();
  await openUrl(trailerUrl(code, mode ?? openMode), sourceTab);
}

/** Open a parsed code, or fall back to searching the raw text when it doesn't parse. */
async function openText(text: string, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const code = parseCode(text);
  if (code) await openCode(code, sourceTab, mode);
  else if (text.trim()) await openUrl(rawSearchUrl(text.slice(0, 100)), sourceTab);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_OPEN && info.selectionText) {
    void openText(info.selectionText, tab);
  } else if (info.menuItemId === MENU_SEARCH && info.selectionText) {
    void openText(info.selectionText, tab, 'search');
  } else if (info.menuItemId === MENU_LINK && info.linkUrl) {
    // Link text isn't available here, so look for a code in the link's URL.
    const code = parseCode(decodeURIComponent(info.linkUrl));
    if (code) void openCode(code, tab);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (tab?.id === undefined) return;
  const mode: OpenMode | undefined = command === 'search-trailer' ? 'search' : undefined;
  try {
    const { code, text } = await sendToTab(tab.id, { type: 'GET_ACTIVE_CODE' });
    if (code) await openCode(code, tab, mode);
    else if (text) await openText(text, tab, mode);
  } catch {
    // No content script on this tab (chrome:// pages, Web Store, or opened before install).
  }
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === 'OPEN_CODE') {
    void (async () => {
      // From the popup there's no sender tab; open next to the active tab instead.
      const [active] = sender.tab ? [sender.tab] : await chrome.tabs.query({ active: true, currentWindow: true });
      await openCode(message.code, active, message.mode);
      sendResponse({ ok: true });
    })();
    return true; // keep the channel open for the async response
  }
  return false;
});
