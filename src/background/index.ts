import popupBlockScript from '../content/popup-block.iife.ts?script&iife';
import { parseCode, rawSearchUrl, trailerUrl, type OpenMode, type VideoCode } from '../shared/codes';
import { isSiteOff, sitePatterns } from '../shared/hosts';
import { sendToTab, type Message } from '../shared/messages';
import { fillTemplate, isWebUrl, type OpenOnSite } from '../shared/open-on';
import { getSettings, seedBuiltIns } from '../shared/storage';

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

chrome.runtime.onInstalled.addListener(async () => {
  // No defaults are written on install: getSettings() fills them in on read, and a write here could
  // overwrite the data synced from the user's other devices.
  await seedBuiltIns().catch((err) => console.error('Offering built-ins failed', err));
  buildMenus((await getSettings()).openOnSites);
  await syncPopupBlocker();
});
chrome.runtime.onStartup.addListener(() => void syncPopupBlocker());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.openOnSites) buildMenus((changes.openOnSites.newValue as OpenOnSite[]) ?? []);
  if (area === 'sync' && changes.popupBlockSites) void syncPopupBlocker();
});

// --- Pop-up blocker ---
// 1. popup-block.iife.ts runs in the page's own world on the chosen sites (registered here, so it
//    only exists on those sites) and blocks window.open, scripted new-tab links and redirects.
// 2. As a backstop, any other new tab such a site opens is closed here, unless the user asked for
//    it (Ctrl/middle-click, a same-site link — announced by the content script) or we opened it.
const POPUP_BLOCK_ID = 'javtr-popup-block';
let popupSync = Promise.resolve();
function syncPopupBlocker() {
  // Serialized: two quick changes must not register the same id twice.
  popupSync = popupSync.then(async () => {
    const { popupBlockSites } = await getSettings();
    await chrome.scripting.unregisterContentScripts({ ids: [POPUP_BLOCK_ID] }).catch(() => {});
    if (!popupBlockSites.length) return;
    await chrome.scripting.registerContentScripts([
      {
        id: POPUP_BLOCK_ID,
        js: [popupBlockScript],
        matches: sitePatterns(popupBlockSites),
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: true,
        matchOriginAsFallback: true, // also about:blank frames the page creates
      },
    ]);
  }).catch((err) => console.error('Pop-up blocker registration failed', err));
  return popupSync;
}

/** Tabs we are about to open, per opener tab, so the backstop leaves them alone. */
const ownTabsPending = new Map<number, number>();
/** Until when a tab may open new tabs because the user asked for one. */
const allowNewTabsUntil = new Map<number, number>();
const blockedCount = new Map<number, number>();

function countBlocked(tabId: number) {
  const n = (blockedCount.get(tabId) ?? 0) + 1;
  blockedCount.set(tabId, n);
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  void chrome.action.setBadgeText({ tabId, text: String(n) });
  void chrome.action.setTitle({ tabId, title: `JAV Trailer Opener — blocked ${n} pop-up${n === 1 ? '' : 's'} / redirect${n === 1 ? '' : 's'} here` });
}

chrome.tabs.onCreated.addListener(async (tab) => {
  const openerId = tab.openerTabId;
  if (openerId === undefined || tab.id === undefined) return;
  const own = ownTabsPending.get(openerId) ?? 0;
  if (own > 0) {
    ownTabsPending.set(openerId, own - 1);
    return;
  }
  const { popupBlockSites } = await getSettings();
  if (!popupBlockSites.length) return;
  const opener = await chrome.tabs.get(openerId).catch(() => undefined);
  let host: string;
  try {
    host = new URL(opener?.url ?? '').hostname;
  } catch {
    return;
  }
  if (!isSiteOff(host, popupBlockSites)) return;
  const allowed = () => (allowNewTabsUntil.get(openerId) ?? 0) > Date.now();
  if (allowed()) return;
  await new Promise((r) => setTimeout(r, 250)); // the content script's "user asked" note may still be on its way
  if (allowed()) return;
  await chrome.tabs.remove(tab.id).catch(() => {});
  countBlocked(openerId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // A new page in the tab: start counting again.
  if (info.status === 'loading' && info.url && blockedCount.has(tabId)) {
    blockedCount.delete(tabId);
    void chrome.action.setBadgeText({ tabId, text: '' });
    void chrome.action.setTitle({ tabId, title: chrome.runtime.getManifest().name });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  blockedCount.delete(tabId);
  allowNewTabsUntil.delete(tabId);
  ownTabsPending.delete(tabId);
});

/** Open URLs in new tabs right after the source tab; only the first takes focus. */
async function openUrls(urls: string[], sourceTab?: chrome.tabs.Tab) {
  const { openInBackground } = await getSettings();
  for (const [i, url] of urls.filter(isWebUrl).entries()) {
    if (sourceTab?.id !== undefined) ownTabsPending.set(sourceTab.id, (ownTabsPending.get(sourceTab.id) ?? 0) + 1);
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
    case 'ALLOW_NEW_TAB':
      if (sender.tab?.id !== undefined) {
        const id = sender.tab.id;
        allowNewTabsUntil.set(id, Math.max(allowNewTabsUntil.get(id) ?? 0, Date.now() + message.ms));
      }
      return reply(Promise.resolve());
    case 'POPUP_BLOCKED':
      if (sender.tab?.id !== undefined) countBlocked(sender.tab.id);
      return reply(Promise.resolve());
  }
  return false;
});
