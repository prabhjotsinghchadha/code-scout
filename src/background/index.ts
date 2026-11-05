import { parseCode, rawSearchUrl, trailerUrl, type OpenMode, type VideoCode } from '../shared/codes';
import { sendToTab, type Message } from '../shared/messages';
import { fillTemplate, isWebUrl, type OpenOnSite } from '../shared/open-on';
import { defaultSettings, getSettings, seedQuickLinks } from '../shared/storage';

const MENU_OPEN = 'open-trailer-selection';
const MENU_SEARCH = 'search-trailer-selection';
const MENU_LINK = 'open-trailer-link';
const MENU_SITES = 'open-on';
const MENU_SITE_PREFIX = 'open-on:';
const MENU_SITES_ALL = 'open-on:*all';

/** (Re)build the right-click menu; the "Open on" submenu lists the user's sites. */
function buildMenus(sites: OpenOnSite[]) {
  chrome.contextMenus.removeAll(() => {
    // "selection" also covers text selected inside inputs and textareas.
    chrome.contextMenus.create({ id: MENU_OPEN, title: 'Open trailer for “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_SEARCH, title: 'Search javtrailers for “%s”', contexts: ['selection'] });
    if (sites.length) {
      chrome.contextMenus.create({ id: MENU_SITES, title: 'Open “%s” on', contexts: ['selection'] });
      for (const site of sites) {
        chrome.contextMenus.create({ id: MENU_SITE_PREFIX + site.id, parentId: MENU_SITES, title: site.name, contexts: ['selection'] });
      }
      if (sites.length > 1) {
        chrome.contextMenus.create({ id: 'open-on-sep', parentId: MENU_SITES, type: 'separator', contexts: ['selection'] });
        chrome.contextMenus.create({
          id: MENU_SITES_ALL,
          parentId: MENU_SITES,
          title: `All ${sites.length} sites`,
          contexts: ['selection'],
        });
      }
    }
    chrome.contextMenus.create({ id: MENU_LINK, title: 'Open trailer for this link', contexts: ['link'] });
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.sync.set(defaultSettings);
  }
  await seedQuickLinks();
  buildMenus((await getSettings()).openOnSites);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.openOnSites) buildMenus((changes.openOnSites.newValue as OpenOnSite[]) ?? []);
});

/** Open URLs in new tabs right after the source tab; only the first takes focus. */
async function openUrls(urls: string[], sourceTab?: chrome.tabs.Tab) {
  const { openInBackground } = await getSettings();
  for (const [i, url] of urls.filter(isWebUrl).entries()) {
    await chrome.tabs.create({
      url,
      active: !openInBackground && i === 0,
      ...(sourceTab?.id !== undefined && {
        index: sourceTab.index + 1 + i,
        openerTabId: sourceTab.id,
        windowId: sourceTab.windowId,
      }),
    });
  }
}

/** `mode` overrides the "Open" setting; omit it to use the setting. */
async function openCode(code: VideoCode, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const { openMode } = await getSettings();
  await openUrls([trailerUrl(code, mode ?? openMode)], sourceTab);
}

/** Open a parsed code, or fall back to searching the raw text when it doesn't parse. */
async function openText(text: string, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const code = parseCode(text);
  if (code) await openCode(code, sourceTab, mode);
  else if (text.trim()) await openUrls([rawSearchUrl(text.slice(0, 100))], sourceTab);
}

/** Open a code on one site (by id) or on all of them (siteId undefined). */
async function openOn(code: VideoCode, siteId: string | undefined, sourceTab?: chrome.tabs.Tab) {
  const { openOnSites } = await getSettings();
  const sites = siteId ? openOnSites.filter((s) => s.id === siteId) : openOnSites;
  await openUrls(sites.map((s) => fillTemplate(s.template, code)), sourceTab);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === MENU_OPEN && info.selectionText) {
    void openText(info.selectionText, tab);
  } else if (id === MENU_SEARCH && info.selectionText) {
    void openText(info.selectionText, tab, 'search');
  } else if (id.startsWith(MENU_SITE_PREFIX) && info.selectionText) {
    const code = parseCode(info.selectionText);
    if (code) void openOn(code, id === MENU_SITES_ALL ? undefined : id.slice(MENU_SITE_PREFIX.length), tab);
  } else if (id === MENU_LINK && info.linkUrl) {
    // Link text isn't available here, so look for a code in the link's URL.
    const code = parseCode(decodeURIComponent(info.linkUrl));
    if (code) void openCode(code, tab);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (tab?.id === undefined) return;
  try {
    const { code, text } = await sendToTab(tab.id, { type: 'GET_ACTIVE_CODE' });
    if (command === 'open-on-all') {
      const parsed = code ?? (text ? parseCode(text) : null);
      if (parsed) await openOn(parsed, undefined, tab);
      return;
    }
    const mode: OpenMode | undefined = command === 'search-trailer' ? 'search' : undefined;
    if (code) await openCode(code, tab, mode);
    else if (text) await openText(text, tab, mode);
  } catch {
    // No content script on this tab (chrome:// pages, Web Store, or opened before install).
  }
});

/** The tab a message came from, or the active tab for messages from the popup. */
async function sourceTabOf(sender: chrome.runtime.MessageSender) {
  if (sender.tab) return sender.tab;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  const reply = (work: Promise<unknown>) => {
    void work.then(() => sendResponse({ ok: true }));
    return true; // keep the channel open for the async response
  };
  switch (message.type) {
    case 'OPEN_CODE':
      return reply(sourceTabOf(sender).then((tab) => openCode(message.code, tab, message.mode)));
    case 'OPEN_URLS':
      return reply(sourceTabOf(sender).then((tab) => openUrls(message.urls, tab)));
    case 'OPEN_OPTIONS':
      return reply(chrome.runtime.openOptionsPage());
  }
  return false;
});
