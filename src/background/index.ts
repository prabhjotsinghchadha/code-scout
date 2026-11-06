import popupBlockScript from '../content/popup-block.iife.ts?script&iife';
import videoBoostScript from '../content/video-boost.iife.ts?script&iife';
import { codeForLink, formatCode, parseCode, rawSearchUrl, searchUrl, trailerUrl, videoUrlIn, type OpenMode, type VideoCode } from '../shared/codes';
import { ACTRESS_LINK_PATTERNS, addActress, capitalized, cleanName, isActressKey, looksLikeActressUrl, nameFromUrl } from '../shared/actresses';
import { restoreFromBackup, updateBackup } from '../shared/fav-backup';
import { addFavourite, addPageFavourite, favouriteError, isFavKey, UNSTARRED_PREFIX } from '../shared/favourites';
import { isSiteOff, sitePatterns } from '../shared/hosts';
import { recordSeen, seenPage, videoPageCode, type SeenPage } from '../shared/seen';
import { addTag, isTagKey, TAG_LINK_PATTERNS, tagNameFromUrl } from '../shared/tags';
import { addVisit, siteOf, VISITS_KEY, type Visits } from '../shared/visits';
import { sendToTab, type ContextLink, type Message, type OcrResult, type OffscreenMessage, type SaveAnswer, type TranslateResult } from '../shared/messages';
import { fillTemplate, isWebUrl, type OpenOnSite } from '../shared/open-on';
import { getSettings, seedBuiltIns } from '../shared/storage';
import { findSubtitles, getSubtitleFile } from './subtitle-search';

const MENU_OPEN = 'open-trailer-selection';
const MENU_SEARCH = 'search-trailer-selection';
const MENU_LINK = 'open-trailer-link';
const MENU_FAVOURITE = 'favourite-selection';
const MENU_FAVOURITE_PAGE = 'favourite-page';
const MENU_ACTRESS = 'actress-selection';
const MENU_ACTRESS_LINK = 'actress-link';
const MENU_TAG_LINK = 'tag-link';
const MENU_SITES = 'open-on';
const MENU_SITE_PREFIX = 'open-on:';
const MENU_SITES_ALL = 'open-on:*all';

/** (Re)build the right-click menu; the "Open on" submenu lists the user's sites. */
function buildMenus(sites: OpenOnSite[]) {
  chrome.contextMenus.removeAll(() => {
    // "selection" also covers text selected inside inputs and textareas.
    chrome.contextMenus.create({ id: MENU_OPEN, title: 'Open trailer for “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_SEARCH, title: 'Search trailers for “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_FAVOURITE, title: 'Add “%s” to favourites', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_ACTRESS, title: 'Add “%s” to favourite actresses', contexts: ['selection'] });
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
    // Only on links to an actress's page ("/actresses/Yua Mikami", "/casts/…").
    chrome.contextMenus.create({
      id: MENU_ACTRESS_LINK,
      title: 'Add this actress to favourites',
      contexts: ['link'],
      targetUrlPatterns: ACTRESS_LINK_PATTERNS,
    });
    // Only on links to a tag's page ("/categories/cheating-wife", "/genres/NTR", "/tag/…").
    chrome.contextMenus.create({
      id: MENU_TAG_LINK,
      title: 'Add this tag to favourites',
      contexts: ['link'],
      targetUrlPatterns: TAG_LINK_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_FAVOURITE_PAGE,
      title: 'Add this page to favourites',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
}

// --- Favourites backup (a bookmarks folder; see fav-backup.ts) ---
// One run at a time, so two runs never add the same bookmark twice.
let backupRun: Promise<void> = Promise.resolve();
function backUpFavourites({ restore = false } = {}): Promise<void> {
  backupRun = backupRun
    .then(async () => {
      await updateBackup();
      // A reinstall starts with no favourites: bring them back from the backup.
      if (restore) await restoreFromBackup();
    })
    .catch((err) => console.warn('Favourites backup failed', err));
  return backupRun;
}

chrome.runtime.onInstalled.addListener(async () => {
  // No defaults are written on install: getSettings() fills them in on read, and a write here could
  // overwrite the data synced from the user's other devices.
  await seedBuiltIns().catch((err) => console.error('Offering built-ins failed', err));
  buildMenus((await getSettings()).openOnSites);
  await syncPageScripts();
  await backUpFavourites({ restore: true });
});
chrome.runtime.onStartup.addListener(() => {
  void syncPageScripts();
  // Also here: a first sync right after a reinstall can replace the restored favourites with none.
  void backUpFavourites({ restore: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.openOnSites) buildMenus((changes.openOnSites.newValue as OpenOnSite[]) ?? []);
  if (area === 'sync' && (changes.popupBlockSites || changes.videoTools || changes.videoOffSites)) void syncPageScripts();
  const unstarred = (key: string) => key.startsWith(UNSTARRED_PREFIX) && changes[key].newValue !== undefined;
  const favKey = (key: string) => isFavKey(key) || isActressKey(key) || isTagKey(key);
  if (Object.keys(changes).some(area === 'sync' ? favKey : unstarred)) void backUpFavourites();
});

// --- Page-world scripts, registered only on the sites that use them ---
// Pop-up blocker:
// 1. popup-block.iife.ts runs in the page's own world on the chosen sites (registered here, so it
//    only exists on those sites) and blocks window.open, scripted new-tab links and redirects.
// 2. As a backstop, any other new tab such a site opens is closed here, unless the user asked for
//    it (Ctrl/middle-click, a same-site link — announced by the content script) or we opened it.
// Video tools: video-boost.iife.ts patches the site's hls.js player for parallel loading and the
// quality menu (the toolbar itself is the content script's video-tools.ts). On every site unless turned
// off, so it's already in place when a page loads (it has to be there before the site's player starts).
const POPUP_BLOCK_ID = 'javtr-popup-block';
const VIDEO_BOOST_ID = 'javtr-video-boost';
let pageScriptSync = Promise.resolve();
function syncPageScripts() {
  // Serialized: two quick changes must not register the same id twice.
  pageScriptSync = pageScriptSync
    .then(async () => {
      const { popupBlockSites, videoTools, videoOffSites } = await getSettings();
      // One at a time: unregistering several ids fails as a whole if one of them isn't registered.
      for (const id of [POPUP_BLOCK_ID, VIDEO_BOOST_ID]) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      }
      const scripts: chrome.scripting.RegisteredContentScript[] = [];
      if (popupBlockSites.length) {
        scripts.push({
          id: POPUP_BLOCK_ID,
          js: [popupBlockScript],
          matches: sitePatterns(popupBlockSites),
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: true,
          matchOriginAsFallback: true, // also about:blank frames the page creates
        });
      }
      if (videoTools) {
        scripts.push({
          id: VIDEO_BOOST_ID,
          js: [videoBoostScript],
          matches: ['http://*/*', 'https://*/*'],
          ...(videoOffSites.length ? { excludeMatches: sitePatterns(videoOffSites) } : {}),
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: true, // players embedded from other sites
        });
      }
      if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
    })
    .catch((err) => console.error('Page script registration failed', err));
  return pageScriptSync;
}

/**
 * A frame from another site on a page with the pop-up blocker on (an embedded video player, with its ad
 * overlays): the blocker's page script, registered for the page's site only, goes into the frame too.
 */
async function blockPopupsInFrame(tab: chrome.tabs.Tab | undefined, frameId: number | undefined) {
  if (tab?.id === undefined || !frameId) return;
  const { popupBlockSites } = await getSettings();
  let host: string;
  try {
    host = new URL(tab.url ?? '').hostname;
  } catch {
    return;
  }
  if (!isSiteOff(host, popupBlockSites)) return;
  await chrome.scripting
    .executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: [popupBlockScript], world: 'MAIN', injectImmediately: true })
    .catch(() => {});
}

/** Tabs we are about to open, per opener tab, so the backstop leaves them alone. */
const ownTabsPending = new Map<number, number>();
/** Until when a tab may open new tabs because the user asked for one. */
const allowNewTabsUntil = new Map<number, number>();
const blockedCount = new Map<number, number>();

function countBlocked(tabId: number) {
  const n = (blockedCount.get(tabId) ?? 0) + 1;
  blockedCount.set(tabId, n);
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#e11d48' });
  void chrome.action.setBadgeText({ tabId, text: String(n) });
  void chrome.action.setTitle({ tabId, title: `${chrome.runtime.getManifest().name} — blocked ${n} pop-up${n === 1 ? '' : 's'} / redirect${n === 1 ? '' : 's'} here` });
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
  tabSite.delete(tabId);
  tabSeenUrl.delete(tabId);
  blockedCount.delete(tabId);
  allowNewTabsUntil.delete(tabId);
  ownTabsPending.delete(tabId);
});

// --- Most visited: count visits to quick-link sites (kept in local storage, on this computer only) ---
/** The site each tab is on, so moving around one site counts as one visit. */
const tabSite = new Map<number, string>();
let visitWrite = Promise.resolve();

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url) return;
  const site = siteOf(info.url);
  if (!site || tabSite.get(tabId) === site) return;
  tabSite.set(tabId, site);
  // One write at a time, so visits in two tabs at once both count.
  visitWrite = visitWrite.then(() => countVisit(site)).catch((err) => console.warn('Counting a visit failed', err));
});

async function countVisit(site: string) {
  const { mostVisited, quickLinks } = await getSettings();
  if (!mostVisited || !quickLinks.some((l) => siteOf(l.url) === site)) return;
  const stored = await chrome.storage.local.get<{ [VISITS_KEY]: Visits }>({ [VISITS_KEY]: {} });
  await chrome.storage.local.set({ [VISITS_KEY]: addVisit(stored[VISITS_KEY], site, Date.now()) });
}

// --- Seen codes: opened from the extension, or their video page visited (local storage, see seen.ts) ---
/** Notes `code` as seen, unless the setting is off or it was seen in an incognito window. */
async function noteSeen(code: VideoCode, from: chrome.tabs.Tab | undefined, page?: SeenPage | null) {
  if (from?.incognito || !(await getSettings()).rememberSeen) return;
  await recordSeen(code, page);
}

/** The video page each tab was last noted on, so its title arriving later only updates the entry. */
const tabSeenUrl = new Map<number, string>();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if ((!info.url && !info.title) || !tab.url) return;
  const code = videoPageCode(tab.url);
  if (!code) {
    tabSeenUrl.delete(tabId);
    return;
  }
  const newPage = tabSeenUrl.get(tabId) !== tab.url;
  if (!newPage && !info.title) return;
  tabSeenUrl.set(tabId, tab.url);
  // A new address's title comes in a later update (until then the tab may still show the last page's).
  void noteSeen(code, tab, seenPage(tab.url, info.title));
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

/** Video pages found by searching javtrailers, by code (while the background stays awake). */
const foundVideoPages = new Map<string, string>();

/**
 * Where "Video page" opens `code`: the page javtrailers' own search links to. Some titles are filed under
 * the studio's ID ("1dldss00578" for DLDSS-578), so the guessed address would be "Page not found". The
 * search results when the search doesn't list it; the guessed address when the search can't be reached.
 */
async function videoPage(code: VideoCode): Promise<string> {
  const key = formatCode(code);
  const found = foundVideoPages.get(key);
  if (found) return found;
  try {
    const response = await fetch(searchUrl(code), { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const url = videoUrlIn(await response.text(), code);
    if (!url) return searchUrl(code);
    foundVideoPages.set(key, url);
    return url;
  } catch (err) {
    console.warn(`Looking up ${key} on javtrailers failed, opening the usual address:`, err);
    return trailerUrl(code, 'video');
  }
}

/** `mode` overrides the "Open" setting; omit it to use the setting. */
async function openCode(code: VideoCode, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const { openMode } = await getSettings();
  const url = (mode ?? openMode) === 'video' ? await videoPage(code) : searchUrl(code);
  await openUrls([url], sourceTab);
  void noteSeen(code, sourceTab);
}

/** Open a parsed code, or fall back to searching the raw text when it doesn't parse. */
async function openText(text: string, sourceTab?: chrome.tabs.Tab, mode?: OpenMode) {
  const code = parseCode(text);
  if (code) await openCode(code, sourceTab, mode);
  else if (text.trim()) await openUrls([rawSearchUrl(text.slice(0, 100))], sourceTab);
}

const notSaved = (err: unknown) => console.warn('Favourite not saved:', favouriteError(err));

/**
 * The name a right-clicked link shows (an actress's, a tag's): its text, asked of the page as the menu only
 * gets the address; else read from the address with `fromUrl`. Null if neither has one.
 */
async function nameOfLink(
  linkUrl: string,
  tab: chrome.tabs.Tab | undefined,
  frameId: number | undefined,
  fromUrl: (url: string) => string | null,
): Promise<string | null> {
  let text = '';
  if (tab?.id !== undefined) {
    const link = await sendToTab(tab.id, { type: 'GET_CONTEXT_LINK' }, frameId).catch(() => null);
    if (link?.url === linkUrl) text = link.text;
  }
  return cleanName(text) ?? fromUrl(linkUrl);
}

/**
 * "Open trailer for this link": the code in its address, else in its text or the card it's in (asked of
 * the page, as the menu only gets the address). Else, if it has a title, javtrailers' search for that.
 */
async function openLink(linkUrl: string, tab: chrome.tabs.Tab | undefined, frameId: number | undefined) {
  let link: ContextLink | null = null;
  if (tab?.id !== undefined) {
    link = await sendToTab(tab.id, { type: 'GET_CONTEXT_LINK' }, frameId).catch(() => null);
    if (link?.url !== linkUrl) link = null;
  }
  const code = codeForLink(linkUrl, link?.text, link?.around);
  if (code) await openCode(code, tab);
  else if (/\p{L}{3}/u.test(link?.text ?? '')) await openUrls([rawSearchUrl(link!.text.replace(/\s+/g, ' ').trim().slice(0, 100))], tab);
  else console.warn('No code in this link:', linkUrl);
}

/** Saves the actress whose link was right-clicked, with the link as her page. */
async function addActressFromLink(linkUrl: string, tab: chrome.tabs.Tab | undefined, frameId: number | undefined) {
  const name = await nameOfLink(linkUrl, tab, frameId, nameFromUrl);
  if (name) await addActress(name, linkUrl);
  else console.warn('No actress name in this link:', linkUrl);
}

/** Saves the tag whose link was right-clicked, adding the link to its pages if it's saved already. */
async function addTagFromLink(linkUrl: string, tab: chrome.tabs.Tab | undefined, frameId: number | undefined) {
  const name = await nameOfLink(linkUrl, tab, frameId, tagNameFromUrl);
  if (name) await addTag(capitalized(name), linkUrl);
  else console.warn('No tag name in this link:', linkUrl);
}

/** Open a code on one site (by id) or on all of them (siteId undefined). */
async function openOn(code: VideoCode, siteId: string | undefined, sourceTab?: chrome.tabs.Tab) {
  const { openOnSites } = await getSettings();
  const sites = siteId ? openOnSites.filter((s) => s.id === siteId) : openOnSites;
  await openUrls(sites.map((s) => fillTemplate(s.template, code)), sourceTab);
  if (sites.length) void noteSeen(code, sourceTab);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === MENU_OPEN && info.selectionText) {
    void openText(info.selectionText, tab);
  } else if (id === MENU_SEARCH && info.selectionText) {
    void openText(info.selectionText, tab, 'search');
  } else if (id === MENU_FAVOURITE && info.selectionText) {
    const code = parseCode(info.selectionText);
    // Selected in a text box means typed, not shown on the page: save no page then.
    const page = !info.editable && info.pageUrl ? { url: info.pageUrl, title: tab?.title } : null;
    if (code) void addFavourite(code, page).catch(notSaved);
  } else if (id === MENU_ACTRESS && info.selectionText) {
    // Selected on her own page ("/actresses/Yua Mikami"): that's her page.
    const page = !info.editable && info.pageUrl && looksLikeActressUrl(info.pageUrl) ? info.pageUrl : null;
    void addActress(info.selectionText, page).catch(notSaved);
  } else if (id === MENU_ACTRESS_LINK && info.linkUrl) {
    void addActressFromLink(info.linkUrl, tab, info.frameId).catch(notSaved);
  } else if (id === MENU_TAG_LINK && info.linkUrl) {
    void addTagFromLink(info.linkUrl, tab, info.frameId).catch(notSaved);
  } else if (id === MENU_FAVOURITE_PAGE && info.pageUrl) {
    // The code in the page's address if it has one ("/videos/MD0273"), else the page itself.
    void addPageFavourite({ url: info.pageUrl, title: tab?.title }).catch(notSaved);
  } else if (id.startsWith(MENU_SITE_PREFIX) && info.selectionText) {
    const code = parseCode(info.selectionText);
    if (code) void openOn(code, id === MENU_SITES_ALL ? undefined : id.slice(MENU_SITE_PREFIX.length), tab);
  } else if (id === MENU_LINK && info.linkUrl) {
    void openLink(info.linkUrl, tab, info.frameId);
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

// --- Subtitle OCR (video tools) ---
// The OCR model runs in an offscreen document: content scripts can't load the extension's WebAssembly,
// and one copy of the model serves every tab. It's created on first use and closed when idle (before
// this service worker itself goes idle and could no longer close it).
const OFFSCREEN_URL = 'src/offscreen/index.html';
const OFFSCREEN_IDLE_MS = 25_000;
let offscreenCreating: Promise<void> | null = null;
let offscreenIdle: ReturnType<typeof setTimeout> | undefined;

async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (open.length) return;
  offscreenCreating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Reads burned-in subtitle text from video frames and translates it, on this computer.',
    })
    .finally(() => (offscreenCreating = null));
  await offscreenCreating;
}

/** Sends `message` to the offscreen document (creating it if needed) and returns its answer. */
async function toOffscreen<T>(message: OffscreenMessage): Promise<T | { error: string }> {
  clearTimeout(offscreenIdle);
  try {
    await ensureOffscreen();
    return ((await chrome.runtime.sendMessage(message)) as T | undefined) ?? { error: 'No answer from the subtitle reader.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(offscreenIdle);
    offscreenIdle = setTimeout(() => void chrome.offscreen.closeDocument().catch(() => {}), OFFSCREEN_IDLE_MS);
  }
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
      return reply(
        sourceTabOf(sender).then(async (tab) => {
          await openUrls(message.urls, tab);
          if (message.code) void noteSeen(message.code, tab);
        }),
      );
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
    case 'OCR_STRIP':
      void toOffscreen<OcrResult>({ target: 'offscreen', type: 'OCR', image: message.image }).then(sendResponse);
      return true;
    case 'TRANSLATE':
      void toOffscreen<TranslateResult>({ target: 'offscreen', type: 'TRANSLATE', text: message.text, from: message.from }).then(
        sendResponse,
      );
      return true;
    // Video tools in a player embedded from another site: the tab's top page helps (frame-bridge.ts).
    case 'TAB_PAGE':
      sendResponse({ url: sender.tab?.url ?? '', title: sender.tab?.title ?? '' });
      return false;
    case 'TRANSLATE_IN_PAGE':
      if (sender.tab?.id === undefined) return false;
      void sendToTab(sender.tab.id, { type: 'PAGE_TRANSLATE', text: message.text, from: message.from }, 0)
        .catch((): TranslateResult => ({ error: 'Reload the page to use EN subs here.' }))
        .then(sendResponse);
      return true;
    case 'SAVE_IN_PAGE':
      if (sender.tab?.id === undefined) return false;
      void sendToTab(sender.tab.id, { type: 'PAGE_SAVE', token: crypto.randomUUID(), name: message.name }, 0)
        .catch((): SaveAnswer => ({ error: 'Reload the page, then try again.' }))
        .then(sendResponse);
      return true;
    case 'FIND_SUBTITLES':
      void findSubtitles(message.code).then(sendResponse);
      return true;
    case 'GET_SUBTITLE_FILE':
      void getSubtitleFile(message.url).then(sendResponse);
      return true;
    case 'BLOCK_POPUPS_IN_FRAME':
      return reply(blockPopupsInFrame(sender.tab, sender.frameId));
  }
  return false;
});
