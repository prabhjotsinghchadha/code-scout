import { codeInUrl, findCodes, formatCode, parseCode, type OpenMode, type VideoCode } from '../shared/codes';
import { englishName } from '../shared/details';
import { aboutSite } from '../shared/sites';
import {
  favouriteError,
  favouriteFor,
  getFavourites,
  onFavouritesChanged,
  removeFavouriteEntry,
  toggleFavourite,
  togglePageFavourite,
  type Favourite,
  type FavouritePage,
} from '../shared/favourites';
import { siteKey } from '../shared/hosts';
import { hydrateIcons, icon } from '../shared/icons';
import { followLook } from '../shared/look';
import { sendToBackground, sendToTab } from '../shared/messages';
import { fillTemplate, type OpenOnSite } from '../shared/open-on';
import { getLater, isLater, onLaterChanged, setLater, type Later } from '../shared/later';
import { getProxy, isProxied, onProxyChanged, updateProxy, withSite, type ProxyState } from '../shared/proxy';
import { recentSeen, seenAgo, type Seen } from '../shared/seen';
import { getSettings, setSettings, type Settings } from '../shared/storage';
import { availableUpdate, dismissUpdate } from '../shared/update';
import { actressRows, setupActresses } from './actresses';
import { allDetails, detailCard, findKnown, learn, setupDetails, subLine } from './details';
import { findLinks, renderLinks, setupLinks } from './links';
import { setupRecent } from './recent';
import { facetsOf, matchesFacet, type Facet } from './filter';
import { filterButton, iconButton, rowActions, rowMain, sortButton } from './rows';
import { PAGE_SORTS, sortByTime, sortPageCodes, storedSort, storeSort, TIME_SORTS, type PageSort, type TimeSort } from './sort';
import { setupTags, tagRows } from './tags';
import { webSection } from './web';

followLook();
hydrateIcons();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Hide what's being watched (background/hide.ts); an open eye while tabs are hidden, to bring them back.
{
  const hideBtn = $<HTMLButtonElement>('hide-btn');
  const KEY = 'hiddenTabs'; // HIDDEN_KEY in background/hide.ts
  void Promise.all([chrome.storage.session.get(KEY), chrome.commands.getAll()]).then(([stored, commands]) => {
    const hidden = !!stored[KEY];
    const shortcut = commands.find((c) => c.name === 'hide-watching')?.shortcut;
    const label = hidden ? 'Bring back the hidden tabs' : 'Hide what you’re watching: pause, mute, tabs out of sight';
    hideBtn.title = shortcut ? `${label} (${shortcut})` : label;
    hideBtn.setAttribute('aria-label', label);
    if (hidden) hideBtn.replaceChildren(icon('eye'));
    hideBtn.classList.toggle('accent', hidden);
  });
  hideBtn.addEventListener('click', () => {
    void sendToBackground({ type: 'TOGGLE_HIDDEN' }).catch(() => {});
    window.close();
  });
}

const form = $<HTMLFormElement>('search');
const input = $<HTMLInputElement>('code-input');
const error = $<HTMLParagraphElement>('error');
const list = $<HTMLUListElement>('codes');
const empty = $<HTMLDivElement>('empty');

/** `mode` undefined = the "Open" setting (video page by default). */
async function open(code: VideoCode, mode?: OpenMode) {
  await sendToBackground({ type: 'OPEN_CODE', code, mode });
  window.close();
}

/** The code in the box: typed ("nsfs484"), or the one a pasted address ends in (".../videos/MD0273"). */
function typedCode(): VideoCode | null {
  const text = input.value.trim();
  return parseCode(text) ?? (/^https?:\/\/\S+$/i.test(text) ? codeInUrl(text) : null);
}

/** Enter in the box: opens the code in it; with other text, the first thing it found. */
function openTyped(mode?: OpenMode) {
  const code = typedCode();
  if (code) void open(code, mode);
  else navItems()[0]?.click();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  openTyped();
});
$('go-open').addEventListener('click', () => openTyped());
$('search-btn').addEventListener('click', () => openTyped('search'));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault(); // not a form submit (Open)
    openTyped('search');
  } else if (e.key === 'Escape' && input.value) {
    e.preventDefault(); // clear the box, don't close the popup
    clearBox();
  }
});
$('clear-btn').addEventListener('click', () => {
  clearBox();
  input.focus();
});

function clearBox() {
  input.value = '';
  input.dispatchEvent(new Event('input'));
}

function textButton(text: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

// --- Tabs ---
type Tab = 'page' | 'favs' | 'recent' | 'links';
const TABS: Tab[] = ['page', 'favs', 'recent', 'links'];
/** The tabs on show (Recent is hidden while "Remember codes you've seen" is off). */
const shownTabs = () => TABS.filter((t) => !$(`tab-${t}`).hidden);
const TAB_KEY = 'popupTab';
/** Set once the user picks a tab, so codes that arrive late don't switch away from it. */
let tabPicked = false;

// The last tab picked is a per-browser convenience, so localStorage is enough.
function storedTab(): Tab | null {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    return shownTabs().includes(tab as Tab) ? (tab as Tab) : null;
  } catch {
    return null;
  }
}

/** The tab on show (none until the page's codes are in, see init). */
let currentTab: Tab | null = null;
/** The box holds text: what it finds is shown instead of the tabs. */
let searching = false;

function applyView() {
  $('tabs').hidden = searching;
  $('panel-find').hidden = !searching;
  for (const t of TABS) {
    const button = $<HTMLButtonElement>(`tab-${t}`);
    button.setAttribute('aria-selected', String(t === currentTab));
    button.tabIndex = t === currentTab ? 0 : -1;
    $(`panel-${t}`).hidden = searching || t !== currentTab;
  }
  if (!searching && currentTab === 'links') renderLinks(); // drawn when first shown
}

function showTab(tab: Tab) {
  currentTab = tab;
  applyView();
}

/** What the arrow keys move between: the rows and tiles of the list on show. */
function navItems(): HTMLElement[] {
  const panel = searching ? $('panel-find') : currentTab && $(`panel-${currentTab}`);
  return panel ? [...panel.querySelectorAll<HTMLElement>('.row-main, .link-main')] : [];
}

/** ↓ from the box goes into the list, ↑ from its first row back to the box; typing anywhere goes to the box. */
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (document.querySelector('.menu')) return; // an open menu has the arrow keys
    const items = navItems();
    const at = items.indexOf(target);
    if (target !== input && at < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = at + (e.key === 'ArrowDown' ? 1 : -1); // from the box, at is -1
      if (target === input && e.key === 'ArrowUp') return;
      e.preventDefault();
      if (next < 0) input.focus();
      else items[next]?.focus();
    } else if (at >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      // → opens the row's card (what the video is), ← closes it.
      const more = target.closest('li')?.querySelector<HTMLButtonElement>('.more-btn');
      if (more && (more.getAttribute('aria-expanded') === 'true') !== (e.key === 'ArrowRight')) {
        e.preventDefault();
        more.click();
      }
    } else if (at >= 0 && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      input.focus(); // the key is typed into the box
    }
  });
}

function pickTab(tab: Tab) {
  tabPicked = true;
  showTab(tab);
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Storage unavailable; the tab just won't be remembered.
  }
}

function setupTabs() {
  for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => pickTab(t));
  // Arrow keys move between tabs, as in any tab list.
  $('tabs').addEventListener('keydown', (e) => {
    const { key } = e as KeyboardEvent;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const tabs = shownTabs();
    const at = tabs.findIndex((t) => $(`tab-${t}`) === document.activeElement);
    if (at < 0) return;
    const next = tabs[(at + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    pickTab(next);
    $(`tab-${next}`).focus();
  });
}

/** This page when it has codes; else the tab picked last time; else Favourites if there are any; else Links. */
function startTab(codes: number): Tab {
  if (codes) return 'page';
  const stored = storedTab();
  if (stored && stored !== 'page') return stored;
  return favs.length || actressCount || tagCount ? 'favs' : 'links';
}

// --- Favourites: Videos | Actresses | Tags ---
type FavKind = 'videos' | 'actresses' | 'tags' | 'later';
const FAV_KINDS: FavKind[] = ['videos', 'actresses', 'tags', 'later'];
let favKind: FavKind = 'videos';
const FAV_KIND_KEY = 'favsKind';
/** How many favourite actresses and tags there are (their views keep these current). */
let actressCount = 0;
let tagCount = 0;

function showFavKind(kind: FavKind) {
  favKind = kind;
  for (const k of FAV_KINDS) {
    $(`favs-kind-${k}`).setAttribute('aria-pressed', String(k === kind));
    $(`favs-${k}`).hidden = k !== kind;
    $(`favs-sort-${k}`).hidden = k !== kind; // each kind has its own sort
  }
  paintFavHead();
}

/** The line under the pills: what the view on show holds, and what can be done with it. */
function paintFavHead() {
  const videos = favKind === 'videos';
  const facet = videos ? favFacet : favKind === 'later' ? laterFacet : null;
  const all = videos ? favs.length : favKind === 'later' ? Object.keys(later).length : favKind === 'actresses' ? actressCount : tagCount;
  const noun = { videos: 'favourite', actresses: 'performer', tags: 'genre', later: 'video' }[favKind];
  const shown = videos ? shownFavs().length : favKind === 'later' ? shownLater().length : all;
  $('favs-title').textContent = facet ? `${shown} of ${all}` : `${all} ${noun}${all === 1 ? '' : 's'}${favKind === 'later' ? ' to watch' : ''}`;
  $('fav-page').hidden = !videos || !tabPage;
  $('favs-filter').hidden = !(videos || favKind === 'later') || all < 2;
  // The chip belongs to the view on show.
  paintFavFilter();
}

/** The switch at the top of Favourites; the kind picked last is a per-browser convenience (localStorage). */
function setupFavKinds() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(FAV_KIND_KEY);
  } catch {
    // Storage unavailable: start on Videos.
  }
  showFavKind(FAV_KINDS.includes(stored as FavKind) ? (stored as FavKind) : 'videos');
  for (const k of FAV_KINDS) {
    $(`favs-kind-${k}`).addEventListener('click', () => {
      showFavKind(k);
      try {
        localStorage.setItem(FAV_KIND_KEY, k);
      } catch {
        // Not remembered, that's all.
      }
    });
  }
}

/** The Favourites tab counts every kind; each kind's pill counts its own. */
function paintFavsCounts() {
  const count = (n: number) => (n ? String(n) : '');
  const laterCount = Object.keys(later).length;
  $('favs-count').textContent = count(favs.length + actressCount + tagCount + laterCount);
  $('favs-later-count').textContent = count(laterCount);
  $('favs-videos-count').textContent = count(favs.length);
  $('favs-actresses-count').textContent = count(actressCount);
  $('favs-tags-count').textContent = count(tagCount);
  paintFavHead();
}

// --- Favourites ---
/** The current tab, saved with codes starred from its list; null on non-web pages. */
let tabPage: FavouritePage | null = null;
/** Codes shown on the current tab ("NSFS-484"). */
let onPage = new Set<string>();
/** Every favourite, newest first. */
let favs: Favourite[] = [];
/** Codes the user starred ("NSFS-484"). */
let starred = new Set<string>();

/** Makes a favourites change, showing why if it couldn't be saved. */
async function saving(change: () => Promise<unknown>) {
  try {
    await change();
    error.hidden = true;
  } catch (err) {
    error.textContent = favouriteError(err);
    error.hidden = false;
  }
}

const toggleStar = (code: VideoCode, page: FavouritePage | null) =>
  saving(async () => {
    const adding = !starred.has(formatCode(code));
    await toggleFavourite(code, adding ? page : null);
    if (adding) learn(code); // a favourite should say what it is
  });

/** ☆ / ★ for the code in the button's data-code (empty = nothing to star). */
function paintStar(b: HTMLButtonElement) {
  const on = starred.has(b.dataset.code ?? '');
  b.replaceChildren(icon(on ? 'starFilled' : 'star'));
  b.classList.toggle('on', on);
  b.title = on ? 'Remove from favourites' : 'Add to favourites';
  b.setAttribute('aria-label', b.title);
}

function starButton(code: VideoCode, page: FavouritePage | null) {
  const b = iconButton('star', 'Add to favourites', 'star quiet', () => void toggleStar(code, page));
  b.dataset.code = formatCode(code);
  paintStar(b);
  return b;
}

/** The ☆ in the code box: the page is saved only if the typed code is shown on it. */
function setupTypedStar() {
  const btn = $<HTMLButtonElement>('star-btn');
  const update = () => {
    const code = typedCode();
    btn.disabled = !code;
    btn.dataset.code = code ? formatCode(code) : '';
    paintStar(btn);
  };
  btn.addEventListener('click', () => {
    const code = typedCode();
    if (code) void toggleStar(code, onPage.has(formatCode(code)) ? tabPage : null);
  });
  input.addEventListener('input', update);
  update();
}

// --- Seen codes: a ✓ after the code in This page and Favourites (the Recent tab lists them) ---
let seenCodes: Seen = {};

/** ✓ and "Seen 3 days ago" on a code label (one with data-code) once its code has been seen. */
function paintSeen(label: HTMLElement) {
  const entry = seenCodes[label.dataset.code ?? ''];
  label.classList.toggle('seen', !!entry);
  label.title = entry ? `Seen ${seenAgo(entry.at, Date.now())}` : '';
}

function onSeenCodes(seen: Seen) {
  seenCodes = seen;
  document.querySelectorAll<HTMLElement>('.code[data-code]').forEach(paintSeen);
}

/** The code's name; `markSeen`: with a ✓ once it has been seen. */
function codeLabel(code: VideoCode, markSeen = true) {
  const label = Object.assign(document.createElement('span'), { className: 'code id', textContent: formatCode(code) });
  if (markSeen) {
    label.dataset.code = formatCode(code);
    paintSeen(label);
  }
  return label;
}

/** A link to a favourite's page, opened next to this tab. */
function pageLink(url: string, title?: string) {
  const a = Object.assign(document.createElement('a'), {
    className: 'fav-page',
    href: url,
    textContent: title || url.replace(/^https?:\/\/(www\.)?/, ''),
    title: url,
  });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void openLinks([url]);
  });
  return a;
}

/**
 * A favourite's row with its page as a link underneath: a code opens its trailer and has Search, Sites and
 * ★; a page starred on its own opens that page.
 */
function favRow(fav: Favourite) {
  let li: HTMLLIElement;
  if (fav.code) {
    li = codeRow(fav.code, codeLabel(fav.code), null, fav.url ? { url: fav.url, title: fav.title } : null);
  } else {
    li = document.createElement('li');
    const site = Object.assign(document.createElement('span'), { className: 'code host', textContent: siteKey(fav.url) });
    const remove = iconButton('starFilled', 'Remove from favourites', 'star on', () => void saving(() => removeFavouriteEntry(fav)));
    li.append(rowMain([icon('link', 12)], site, `Open ${fav.url}`, () => void openLinks([fav.url]), 'plain'), rowActions(remove));
  }
  if (fav.url) li.append(pageLink(fav.url, fav.title));
  return li;
}

/** "Star this page" in the Favourites tab: stars the tab (the code in its address, if it has one). */
function setupStarPage() {
  const page = tabPage;
  if (!page) return;
  const btn = $<HTMLButtonElement>('fav-page');
  btn.hidden = false;
  btn.addEventListener('click', () => void saving(() => togglePageFavourite(page)));
  paintStarPage();
}

function paintStarPage() {
  const btn = $<HTMLButtonElement>('fav-page');
  const on = !!tabPage && !!favouriteFor(favs, tabPage.url);
  btn.replaceChildren(icon(on ? 'starFilled' : 'star', 14), on ? 'Page starred' : 'Star page');
  btn.classList.toggle('on', on);
  btn.title = on ? 'Remove this page from favourites' : 'Add the page you’re on to favourites';
}

/** Lower case, without spaces and dashes, so "nsfs484" finds "NSFS-484". */
const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

/** How the favourite videos are sorted (the Videos view's sort button). */
let favSort: TimeSort = storedSort('favs-videos', TIME_SORTS);

/** Favourites narrowed to one label, performer or studio (null: all of them). Not kept between openings. */
let favFacet: Facet | null = null;
let laterFacet: Facet | null = null;
/** Redraws the filter button and chip for the view on show (set up in init). */
let paintFavFilter = () => {};

const shownFavs = () => (favFacet ? favs.filter((f) => f.code && matchesFacet(f.code, favFacet!, allDetails())) : favs);

function paintFavs() {
  $('favs').replaceChildren(...sortByTime(shownFavs(), favSort, (f) => f.added, (f) => f.code).map(favRow));
}

// --- Watch later: videos put aside (later.ts), the fourth view in Favourites ---
let later: Later = {};
let laterSort: TimeSort = storedSort('favs-later', TIME_SORTS);

const laterList = () => recentSeen(later);
const shownLater = () => (laterFacet ? laterList().filter((l) => matchesFacet(l.code, laterFacet!, allDetails())) : laterList());

function paintLater() {
  const rows = sortByTime(shownLater(), laterSort, (l) => l.at, (l) => l.code).map((l) => {
    const page = l.url ? { url: l.url, title: l.title } : null;
    const li = codeRow(l.code, codeLabel(l.code), page, page);
    li.classList.add('seen-row');
    const meta = Object.assign(document.createElement('div'), { className: 'seen-meta' });
    meta.append(Object.assign(document.createElement('span'), { className: 'when', textContent: `Added ${seenAgo(l.at, Date.now())}` }));
    if (l.url) meta.append(pageLink(l.url, l.title));
    const done = iconButton('x', `Take ${formatCode(l.code)} off Watch later`, 'forget quiet', () => void setLater(l.code, false));
    done.replaceChildren(icon('x', 13));
    meta.append(done);
    li.append(meta);
    return li;
  });
  $('later').replaceChildren(...rows);
  $('later-empty').hidden = Object.keys(later).length > 0;
}

async function renderFavourites() {
  favs = await getFavourites();
  starred = new Set(favs.flatMap((f) => (f.code ? [formatCode(f.code)] : [])));
  paintFavsCounts();
  $('favs-empty').hidden = favs.length > 0;
  paintFavs();
  document.querySelectorAll<HTMLButtonElement>('button.star[data-code]').forEach(paintStar);
  paintStarPage();
}

/**
 * The chevron after a code's row: opens its card under `li` (what it is, who's in it, where to watch it),
 * and closes it again. `source`: the page it was starred, seen or found on, offered in the card.
 */
function moreButton(li: HTMLLIElement, code: VideoCode, source: FavouritePage | null): HTMLButtonElement {
  let card: HTMLLIElement | null = null;
  const more = iconButton('chevronDown', `What ${formatCode(code)} is, and where to watch it`, 'more-btn', () => {
    if (card) {
      card.remove();
      card = null;
    } else {
      card = detailCard(
        code,
        {
          openLinks,
          siteRow: (c) => (sites.length ? siteRow(() => c, 'Watch on') : null),
          isLater: (c) => isLater(later, c),
          // With the page it's on, if it's one of this page's codes; else the page it was starred or seen on.
          setLater: (c, on) => setLater(c, on, source ?? (onPage.has(formatCode(c)) ? tabPage : null)),
        },
        source,
      );
      // After the row's own lines (they're part of this <li>), as the next row.
      li.after(card);
    }
    more.setAttribute('aria-expanded', String(!!card));
    li.classList.toggle('open', !!card);
  });
  more.setAttribute('aria-expanded', 'false');
  return more;
}

/**
 * A row for a code: click it to open the trailer (▶; a grey ✓ once seen). Under it, once known, what the
 * video is. After it: Search and ☆ (shown while the row is pointed at or has the focus) and a chevron that
 * opens its card: what it is, who's in it, and where to watch it. `source`: the page it was starred or
 * seen on, offered in the card.
 */
function codeRow(code: VideoCode, label: HTMLElement, page: FavouritePage | null, source: FavouritePage | null = null): HTMLLIElement {
  const li = document.createElement('li');
  const name = formatCode(code);
  const more = moreButton(li, code, source);
  const actions = rowActions(
    iconButton('search', `Search javtrailers.com for ${name}`, 'quiet', () => void open(code, 'search')),
    starButton(code, page),
    more,
  );
  li.append(rowMain([icon('play', 10), icon('check', 12)], label, `Open the trailer for ${name}`, () => void open(code)), actions, subLine(code));
  return li;
}

/** Codes on the tab: the one in its address first (the page's text may never show it), then the page's. */
async function pageCodes(tab: chrome.tabs.Tab | undefined): Promise<VideoCode[]> {
  const fromUrl = tab?.url ? codeInUrl(tab.url) : null;
  let codes: VideoCode[] = fromUrl ? [fromUrl] : [];
  if (tab?.id !== undefined) {
    try {
      codes = [...codes, ...(await sendToTab(tab.id, { type: 'GET_PAGE_CODES' })).codes];
    } catch {
      // No content script here: a tab opened before install or an update, site access withheld, or a
      // page Chrome keeps extensions out of. Read the page from here instead.
      noContentScript(tab);
      codes = [...codes, ...(await readPageCodes(tab.id))];
    }
  }
  return [...new Map(codes.map((code) => [formatCode(code), code])).values()];
}

/**
 * The codes in a tab's text, read by the popup itself. Opening the popup grants access to the tab
 * (activeTab), so this works on pages where Code Scout's content script isn't running.
 */
async function readPageCodes(tabId: number): Promise<VideoCode[]> {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText ?? '',
      injectImmediately: true, // a page still loading: read what's there
    });
    return typeof frame?.result === 'string' ? findCodes(frame.result).map((m) => m.code) : [];
  } catch {
    return []; // chrome:// pages, the Web Store, the PDF viewer...
  }
}

/**
 * A web page that didn't answer was open before Code Scout was installed, updated or reloaded: its old
 * copy is cut off, so the ▶ buttons and video tools don't work there until the page is reloaded (the
 * codes list does: the popup reads the page itself). Say so.
 */
function noContentScript(tab: chrome.tabs.Tab | undefined) {
  const url = tab?.url ?? '';
  if (!/^https?:/.test(url) || tab?.status !== 'complete') return; // still loading: the script comes later
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//.test(url)) return; // never allowed
  $('reload-label').textContent = 'Reload the page for the ▶ buttons and video tools';
  $('reload-tab').title = 'This page was open before Code Scout was installed or updated';
  $('reload-tab').hidden = false;
}

/** How This page is sorted. */
let pageSort: PageSort = storedSort('page', PAGE_SORTS);

function paintPageCodes() {
  const codes = sortPageCodes(pageCodeList, pageSort, (code) => !!seenCodes[formatCode(code)]);
  list.replaceChildren(...codes.map((code) => codeRow(code, codeLabel(code), tabPage)));
}

function renderPageCodes(codes: VideoCode[]) {
  empty.hidden = codes.length > 0;
  pageCodeList = codes;
  onPage = new Set(codes.map(formatCode));
  $('codes-count').textContent = codes.length ? String(codes.length) : '';
  $('page-head').hidden = codes.length < 2; // nothing to sort
  $('page-title').textContent = `${codes.length} codes on this page`;
  paintPageCodes();
  if (searching) paintFind(); // the page's codes came in after the first keys
}

// --- The box: a code to open, or text to find in every list ---
/** Codes on the current tab, in page order. */
let pageCodeList: VideoCode[] = [];
/** Video rows shown at most for one search. */
const FIND_MAX = 40;

function findSection(title: string, body: HTMLElement, count: number) {
  const box = Object.assign(document.createElement('section'), { className: 'find-section' });
  const head = Object.assign(document.createElement('div'), { className: 'section-head' });
  head.append(
    Object.assign(document.createElement('span'), { className: 'section-title', textContent: title }),
    Object.assign(document.createElement('span'), { className: 'count', textContent: count ? String(count) : '' }),
  );
  box.append(head, body);
  return box;
}

function rowList(rows: HTMLLIElement[]) {
  const ul = Object.assign(document.createElement('ul'), { className: 'list' });
  ul.append(...rows);
  return ul;
}

/** Codes matching `has`, each once: the page's first, then favourites, then seen ones (newest first). */
function findVideos(has: (...texts: (string | undefined)[]) => boolean): HTMLLIElement[] {
  const rows = new Map<string, HTMLLIElement>();
  const add = (code: VideoCode, page: FavouritePage | null) => {
    const key = formatCode(code);
    if (rows.has(key) || rows.size >= FIND_MAX) return;
    const li = codeRow(code, codeLabel(code), page, page === tabPage ? null : page);
    const fav = favs.find((f) => f.code && formatCode(f.code) === key);
    const seen = seenCodes[key];
    if (fav?.url) {
      li.append(pageLink(fav.url, fav.title));
    } else if (seen) {
      const meta = Object.assign(document.createElement('div'), { className: 'seen-meta' });
      meta.append(Object.assign(document.createElement('span'), { className: 'when', textContent: seenAgo(seen.at, Date.now()) }));
      if (seen.url) meta.append(pageLink(seen.url, seen.title));
      li.append(meta);
    }
    rows.set(key, li);
  };
  // By code first, then by the title of the page it was starred or seen on (not its address: "mi" would
  // find every video from missav).
  const recent = recentSeen(seenCodes);
  const seenPage = (s: (typeof recent)[number]) => (s.url ? { url: s.url, title: s.title } : null);
  for (const code of pageCodeList) if (has(formatCode(code))) add(code, tabPage);
  for (const f of favs) if (f.code && has(formatCode(f.code))) add(f.code, null);
  for (const s of recent) if (has(formatCode(s.code))) add(s.code, seenPage(s));
  for (const f of favs) if (f.code && has(f.title)) add(f.code, null);
  for (const s of recent) if (has(s.title)) add(s.code, seenPage(s));
  // …and by what the video is, where that's known: its title, who's in it, its studio and series.
  for (const [key, d] of Object.entries(allDetails())) {
    const known = parseCode(key);
    const listed = known && (starred.has(key) || seenCodes[key] || onPage.has(key));
    if (known && listed && has(d.title, ...d.cast.map((c) => c.name), d.studio?.name, d.series?.name)) {
      add(known, seenCodes[key]?.url ? { url: seenCodes[key].url!, title: seenCodes[key].title } : null);
    }
  }
  return [...rows.values()];
}

/** Shows what the box's text finds (and, for a code, the buttons that open it), or the tabs when it's empty. */
/** A result that isn't in any list: chips for the performers, studios or genres of videos looked at. */
function knownSection(title: string, items: { name: string; url: string }[]) {
  const row = Object.assign(document.createElement('div'), { className: 'site-row known' });
  for (const item of items) {
    const chip = textButton(englishName(item.name), 'chip row-main', () => void openLinks([item.url]));
    chip.title = `${item.name}\nOpen on javtrailers`;
    row.append(chip);
  }
  return findSection(title, row, items.length);
}

function paintFind() {
  const raw = input.value.trim();
  const code = typedCode();
  $('go').hidden = !code;
  if (code) $('go-code').textContent = formatCode(code);
  $('clear-btn').hidden = !input.value;
  error.hidden = true;
  searching = !!raw;
  applyView();
  const box = $('find');
  if (!raw) {
    box.replaceChildren();
    return;
  }
  // "nsfs00484" finds NSFS-484 too.
  const needles = [...new Set([squash(raw), code ? squash(formatCode(code)) : ''])].filter(Boolean);
  const has = (...texts: (string | undefined)[]) => texts.some((t) => !!t && needles.some((n) => squash(t).includes(n)));

  const out: HTMLElement[] = [];
  const videos = findVideos(has);
  if (videos.length) out.push(findSection('Videos', rowList(videos), videos.length));
  const pages = favs.filter((f) => !f.code && has(f.title, f.url)).map(favRow);
  if (pages.length) out.push(findSection('Starred pages', rowList(pages), pages.length));
  const actresses = actressRows(raw);
  if (actresses.length) out.push(findSection('Favourite performers', rowList(actresses), actresses.length));
  const tags = tagRows(raw);
  if (tags.length) out.push(findSection('Favourite genres', rowList(tags), tags.length));
  const links = findLinks(raw);
  if (links) out.push(findSection('Links', links.list, links.count));
  // Names met in videos looked at, saved or not: a performer can be found before she's a favourite.
  if (!code) {
    const known = findKnown((text) => has(text));
    // Not the favourites again: they're listed above.
    const saved = new Set(actresses.map((row) => squash(row.querySelector('.code')?.textContent ?? '')));
    known.performers = known.performers.filter((p) => !saved.has(squash(englishName(p.name))));
    if (known.performers.length) out.push(knownSection('Performers in your videos', known.performers));
    if (known.studios.length) out.push(knownSection('Studios and series', known.studios));
    if (known.genres.length) out.push(knownSection('Genres', known.genres));
  }
  // Never a dead end: what isn't in the lists can be looked for on a site, and picked from here (web.ts).
  const listed = out.length;
  out.push(
    webSection(code ? formatCode(code) : raw.slice(0, 100), {
      openLinks,
      codeLabel,
      actions: (li, c, page) => [starButton(c, page), moreButton(li, c, page)],
    }),
  );
  box.replaceChildren(...out);
  $('panel-find').scrollTop = 0;

  $('find-empty').hidden = listed > 0 || !code;
  $('find-empty-text').textContent = code ? `${formatCode(code)} isn’t in your lists yet. Press Enter to open its trailer.` : '';
}

let sites: OpenOnSite[] = [];

/** A row of "Open on" site buttons for the code `getCode()` returns (null = nothing to open). */
function siteRow(getCode: () => VideoCode | null, label?: string): HTMLDivElement {
  const row = Object.assign(document.createElement('div'), { className: 'site-row' });
  if (label) row.append(Object.assign(document.createElement('span'), { className: 'label', textContent: label }));
  const go = (targets: OpenOnSite[]) => {
    const code = getCode();
    if (code) void openLinks(targets.map((s) => fillTemplate(s.template, code)), code);
  };
  for (const site of sites) {
    const chip = textButton(site.name, 'chip', () => go([site]));
    chip.title = aboutSite(site.id) ?? `Open it on ${site.name}`; // what the site is for (sites.ts)
    row.append(chip);
  }
  if (sites.length > 1) row.append(textButton(`All ${sites.length}`, 'chip all', () => go(sites)));
  return row;
}

/** Site buttons under the code box, shown once the typed text is a code. */
function setupTypedSites() {
  const row = $('typed-sites');
  if (!sites.length) return;
  row.replaceChildren(...siteRow(typedCode, 'Watch on').childNodes);
  const update = () => (row.hidden = !typedCode());
  input.addEventListener('input', update);
  update();
}

/**
 * Opened by the background (next to this tab), so the pop-up blocker knows they're ours. `code`: the code
 * they open, noted as seen.
 */
async function openLinks(urls: string[], code?: VideoCode) {
  await sendToBackground({ type: 'OPEN_URLS', urls, code });
  window.close();
}

/**
 * The site bar: switches for the current tab's site. "Buttons" is on unless the site is in offSites; "Block
 * pop-ups" and "Video tools" are on when it's in their list.
 */
function setupSiteToggles(settings: Settings, tab: chrome.tabs.Tab | undefined) {
  const host = tab?.url && /^https?:/.test(tab.url) ? siteKey(tab.url) : null;
  if (!host) return;
  document.querySelectorAll('.site-host').forEach((el) => (el.textContent = host));
  $('site-bar').hidden = false;

  const toggles = [
    ['site-buttons', 'offSites', true],
    ['site-popups', 'popupBlockSites', false],
    ['site-video', 'videoOffSites', true],
  ] as const;
  for (const [id, key, invert] of toggles) {
    const box = $<HTMLInputElement>(id);
    box.checked = settings[key].includes(host) !== invert;
    box.addEventListener('change', async () => {
      const listed = box.checked !== invert;
      const current = (await getSettings())[key].filter((s) => s !== host);
      await setSettings({ [key]: listed ? [...current, host] : current });
      // The page-side blocker and video tools only load with the page.
      if (key !== 'offSites') $('reload-tab').hidden = false;
    });
  }
  if (!settings.inlineButtons && !settings.fieldChip) {
    const box = $<HTMLInputElement>('site-buttons');
    box.disabled = true;
    box.closest('label')!.title = 'The ▶ buttons and chip are turned off everywhere. Turn them on in Settings.';
  }
  if (!settings.videoTools) {
    const box = $<HTMLInputElement>('site-video');
    box.disabled = true;
    box.closest('label')!.title = 'Video tools are turned off everywhere. Turn them on in Settings.';
  }
  $('reload-tab').addEventListener('click', async () => {
    if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    window.close();
  });
  void setupSiteProxy(host);
}

/**
 * The site bar's Proxy switch (this site goes through the proxy server, shared/proxy.ts) and, under it, the
 * server in use: picked from the ones saved in Settings, or Off for none.
 */
async function setupSiteProxy(host: string) {
  const box = $<HTMLInputElement>('site-proxy');
  const picker = $<HTMLSelectElement>('proxy-server');
  let state = await getProxy();
  const OFF = '';

  const render = () => {
    const through = isProxied(host, state.sites);
    box.checked = through;
    $('proxy-line').hidden = !state.servers.length || !state.sites.length;
    picker.replaceChildren(
      new Option('Off', OFF),
      ...state.servers.map((s) => new Option(s.name, s.id)),
    );
    picker.value = state.on ? (state.active ?? OFF) : OFF;
    const n = state.sites.length;
    $('proxy-label').textContent = !state.on
      ? 'Proxy is off: every site connects directly'
      : through
        ? 'This site goes through'
        : `${n} site${n === 1 ? '' : 's'} (not this one) go${n === 1 ? 'es' : ''} through`;
  };
  const change = async (edit: (state: ProxyState) => ProxyState) => {
    state = await updateProxy(edit);
    render();
    // Connections already open to the site stay as they were until the page loads again.
    $('reload-tab').hidden = false;
  };

  box.addEventListener('change', () => {
    // No server yet: Settings is where one is added.
    if (box.checked && !state.servers.length) {
      box.checked = false;
      void sendToBackground({ type: 'OPEN_OPTIONS', section: 'proxy' });
      window.close();
      return;
    }
    // Switching a site on is asking for the proxy: it's turned on with it.
    const through = box.checked;
    void change((s) => ({ ...s, sites: withSite(s.sites, host, through), on: through ? true : s.on }));
  });
  picker.addEventListener('change', () => {
    const id = picker.value;
    void change((s) => (id === OFF ? { ...s, on: false } : { ...s, on: true, active: id }));
  });
  onProxyChanged((next) => {
    state = next;
    render();
  });
  render();
}

/** Wait this long for the page's codes before picking the starting tab without them. */
const CODES_WAIT_MS = 400;

/** "Version x is out": this copy is loaded from a folder, so Chrome never updates it by itself. */
async function showUpdate() {
  const release = await availableUpdate().catch(() => null);
  if (!release) return;
  $('update-version').textContent = release.version;
  $('update-current').textContent = chrome.runtime.getManifest().version;
  $('update').hidden = false;
  $('update-get').addEventListener('click', () => {
    void chrome.tabs.create({ url: release.url });
    window.close();
  });
  $('update-close').addEventListener('click', () => {
    $('update').hidden = true;
    void dismissUpdate(release.version);
  });
}

async function init() {
  setupTabs();
  setupKeys();
  sortButton($<HTMLButtonElement>('page-sort'), PAGE_SORTS, () => pageSort, (value) => {
    pageSort = value;
    storeSort('page', value);
    paintPageCodes();
  });
  sortButton($<HTMLButtonElement>('favs-sort-videos'), TIME_SORTS, () => favSort, (value) => {
    favSort = value;
    storeSort('favs-videos', value);
    paintFavs();
  });
  sortButton($<HTMLButtonElement>('favs-sort-later'), TIME_SORTS, () => laterSort, (value) => {
    laterSort = value;
    storeSort('favs-later', value);
    paintLater();
  });
  // One filter button for Favourites: it narrows the view on show (Videos or Later).
  paintFavFilter = filterButton(
    $<HTMLButtonElement>('favs-filter'),
    $<HTMLButtonElement>('favs-facet'),
    () => (favKind === 'later' ? laterList().map((l) => l.code) : favs.flatMap((f) => f.code ?? [])),
    allDetails,
    () => (favKind === 'later' ? laterFacet : favFacet),
    (facet) => {
      if (favKind === 'later') {
        laterFacet = facet;
        paintLater();
      } else {
        favFacet = facet;
        paintFavs();
      }
      paintFavHead();
    },
  );
  input.addEventListener('input', paintFind);
  const [settings, [tab]] = await Promise.all([
    getSettings(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const codesReady = pageCodes(tab); // ask the page now, while the rest renders

  sites = settings.openOnSites;
  tabPage = tab?.url && /^https?:/.test(tab.url) ? { url: tab.url, title: tab.title } : null;
  setupTypedSites();
  setupFavKinds();
  const countActresses = (n: number) => {
    actressCount = n;
    paintFavsCounts();
  };
  const countTags = (n: number) => {
    tagCount = n;
    paintFavsCounts();
  };
  // Favourites before the page's codes, so their stars are right.
  document.body.classList.toggle('compact', settings.listStyle === 'compact');
  await setupDetails(); // before any row is drawn: rows say what their codes are
  later = await getLater().catch(() => ({}));
  onLaterChanged((next) => {
    later = next;
    paintLater();
    paintFavsCounts();
  });
  paintLater();
  await Promise.all([renderFavourites(), setupActresses(openLinks, countActresses), setupTags(openLinks, countTags)]);
  onFavouritesChanged(() => void renderFavourites());
  setupStarPage();
  setupTypedStar();
  setupSiteToggles(settings, tab);
  if (settings.rememberSeen) {
    void setupRecent({ row: (code, page) => codeRow(code, codeLabel(code, false), page, page), pageLink, onChange: onSeenCodes });
  } else {
    $('tab-recent').hidden = true;
  }

  // "From your favourites" in Links: the performers and studios the starred videos have most of.
  const picks = () => {
    const found = facetsOf(favs.flatMap((f) => f.code ?? []), allDetails(), 3);
    return [...found.performer, ...found.studio].filter((f) => f.url);
  };
  await setupLinks(settings, tab, openLinks, picks);
  if (input.value) paintFind(); // typed while the lists were loading

  const openGuide = () => {
    void sendToBackground({ type: 'OPEN_OPTIONS', section: 'guide' });
    window.close();
  };
  $('open-guide').addEventListener('click', openGuide);
  // "New here?": once, for an install that has nothing yet. Either button closes it for good, everywhere
  // (a synced setting); installs from before the card never see it (the background marks them).
  if (!settings.introSeen && !favs.length && !actressCount && !tagCount && !Object.keys(seenCodes).length) {
    const seen = () => {
      $('intro').hidden = true;
      void setSettings({ introSeen: true });
    };
    $('intro').hidden = false;
    $('intro-close').addEventListener('click', seen);
    $('intro-guide').addEventListener('click', () => {
      seen();
      openGuide();
    });
  }

  void showUpdate();

  for (const id of ['open-options', 'add-links']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  // Pick the starting tab once the codes are in (or after a moment, if the page is slow to answer).
  const codes = await Promise.race([codesReady, new Promise<null>((r) => setTimeout(() => r(null), CODES_WAIT_MS))]);
  if (codes) renderPageCodes(codes);
  showTab(startTab(codes?.length ?? 0));
  if (!codes) {
    const late = await codesReady;
    renderPageCodes(late);
    if (late.length && !tabPicked) showTab('page');
  }
}

void init();
