import { codeInUrl, formatCode, parseCode, type OpenMode, type VideoCode } from '../shared/codes';
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
import { hydrateIcons, icon, type IconName } from '../shared/icons';
import { sendToBackground, sendToTab } from '../shared/messages';
import { fillTemplate, type OpenOnSite } from '../shared/open-on';
import { addGroup, groupLinks, validateGroupName, type LinkState, type QuickLink } from '../shared/quick-links';
import { defaultLinkName, getSettings, normalizeUrl, setSettings, type Settings } from '../shared/storage';

hydrateIcons();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

function openTyped(mode?: OpenMode) {
  const code = parseCode(input.value);
  error.hidden = !!code;
  if (!code) {
    error.textContent = 'That doesn’t look like a code. Try one like NSFS-484.';
    return;
  }
  void open(code, mode);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  openTyped();
});
$('search-btn').addEventListener('click', () => openTyped('search'));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault(); // not a form submit (Open)
    openTyped('search');
  }
});

function textButton(text: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

/** A square icon button; `label` is its tooltip and accessible name. */
function iconButton(name: IconName, label: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn ${className}`.trim();
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

// --- Tabs ---
type Tab = 'page' | 'favs' | 'links';
const TABS: Tab[] = ['page', 'favs', 'links'];
const TAB_KEY = 'popupTab';
/** Set once the user picks a tab, so codes that arrive late don't switch away from it. */
let tabPicked = false;

// The last tab picked is a per-browser convenience, so localStorage is enough.
function storedTab(): Tab | null {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    return TABS.includes(tab as Tab) ? (tab as Tab) : null;
  } catch {
    return null;
  }
}

function showTab(tab: Tab) {
  for (const t of TABS) {
    const button = $<HTMLButtonElement>(`tab-${t}`);
    button.setAttribute('aria-selected', String(t === tab));
    button.tabIndex = t === tab ? 0 : -1;
    $(`panel-${t}`).hidden = t !== tab;
  }
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
  document.querySelector('.tabs')!.addEventListener('keydown', (e) => {
    const { key } = e as KeyboardEvent;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const at = TABS.findIndex((t) => $(`tab-${t}`) === document.activeElement);
    if (at < 0) return;
    const next = TABS[(at + (key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    pickTab(next);
    $(`tab-${next}`).focus();
  });
}

/** This page when it has codes; else the tab picked last time; else Favourites if there are any; else Links. */
function startTab(codes: number): Tab {
  if (codes) return 'page';
  const stored = storedTab();
  if (stored && stored !== 'page') return stored;
  return favs.length ? 'favs' : 'links';
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
/** The favourites filter shows from this many favourites up. */
const FILTER_FROM = 8;
const favsFilter = $<HTMLInputElement>('favs-filter');

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
  saving(() => toggleFavourite(code, starred.has(formatCode(code)) ? null : page));

/** ☆ / ★ for the code in the button's data-code (empty = nothing to star). */
function paintStar(b: HTMLButtonElement) {
  const on = starred.has(b.dataset.code ?? '');
  b.replaceChildren(icon(on ? 'starFilled' : 'star'));
  b.classList.toggle('on', on);
  b.title = on ? 'Remove from favourites' : 'Add to favourites';
  b.setAttribute('aria-label', b.title);
}

function starButton(code: VideoCode, page: FavouritePage | null) {
  const b = iconButton('star', 'Add to favourites', 'star', () => void toggleStar(code, page));
  b.dataset.code = formatCode(code);
  paintStar(b);
  return b;
}

/** The ☆ in the code box: the page is saved only if the typed code is shown on it. */
function setupTypedStar() {
  const btn = $<HTMLButtonElement>('star-btn');
  const update = () => {
    const code = parseCode(input.value);
    btn.disabled = !code;
    btn.dataset.code = code ? formatCode(code) : '';
    paintStar(btn);
  };
  btn.addEventListener('click', () => {
    const code = parseCode(input.value);
    if (code) void toggleStar(code, onPage.has(formatCode(code)) ? tabPage : null);
  });
  input.addEventListener('input', update);
  update();
}

const codeLabel = (code: VideoCode) =>
  Object.assign(document.createElement('span'), { className: 'code', textContent: formatCode(code) });

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
 * A favourite's row with its page as a full-width link underneath: a code gets Open, Search, Sites and ★;
 * a page starred on its own gets its site's name and ★.
 */
function favRow(fav: Favourite) {
  let li: HTMLLIElement;
  if (fav.code) {
    li = codeRow(fav.code, codeLabel(fav.code), null);
  } else {
    li = document.createElement('li');
    const site = Object.assign(document.createElement('span'), { className: 'code host', textContent: siteKey(fav.url) });
    const remove = iconButton('starFilled', 'Remove from favourites', 'star on', () => void saving(() => removeFavouriteEntry(fav)));
    li.append(site, remove);
  }
  li.classList.add('fav');
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
  btn.replaceChildren(icon(on ? 'starFilled' : 'star', 14), on ? 'Starred' : 'Star this page');
  btn.classList.toggle('on', on);
  btn.title = on ? 'Remove this page from favourites' : 'Add the page you’re on to favourites';
}

/** Lower case, without spaces and dashes, so "nsfs484" finds "NSFS-484". */
const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

function paintFavList() {
  const query = squash(favsFilter.value);
  const shown = query
    ? favs.filter((f) => [f.code ? formatCode(f.code) : '', f.title ?? '', f.url ?? ''].some((s) => squash(s).includes(query)))
    : favs;
  favsFilter.hidden = favs.length < FILTER_FROM && !favsFilter.value;
  $('favs').replaceChildren(...shown.map(favRow));
  $('favs-none').hidden = !favs.length || shown.length > 0;
}

async function renderFavourites() {
  favs = await getFavourites();
  starred = new Set(favs.flatMap((f) => (f.code ? [formatCode(f.code)] : [])));
  $('favs-count').textContent = favs.length ? String(favs.length) : '';
  $('favs-empty').hidden = favs.length > 0;
  paintFavList();
  document.querySelectorAll<HTMLButtonElement>('button.star[data-code]').forEach(paintStar);
  paintStarPage();
}

/** A row for a code: Open, Search, Sites (toggles a row of site buttons below it) and ☆. */
function codeRow(code: VideoCode, label: HTMLElement, page: FavouritePage | null): HTMLLIElement {
  const li = document.createElement('li');
  li.append(
    label,
    iconButton('play', 'Open trailer', 'accent', () => void open(code)),
    iconButton('search', 'Search javtrailers.com', '', () => void open(code, 'search')),
  );
  let sitesRow: HTMLLIElement | null = null;
  if (sites.length) {
    const toggle = iconButton('globe', 'Open on other sites', '', () => {
      if (sitesRow) {
        sitesRow.remove();
        sitesRow = null;
      } else {
        sitesRow = Object.assign(document.createElement('li'), { className: 'sites' });
        sitesRow.append(siteRow(() => code));
        li.after(sitesRow);
      }
      toggle.setAttribute('aria-expanded', String(!!sitesRow));
    });
    toggle.setAttribute('aria-expanded', 'false');
    li.append(toggle);
  }
  li.append(starButton(code, page));
  return li;
}

/** Codes on the tab: the one in its address first (the page's text may never show it), then the page's. */
async function pageCodes(tab: chrome.tabs.Tab | undefined): Promise<VideoCode[]> {
  const fromUrl = tab?.url ? codeInUrl(tab.url) : null;
  let codes: VideoCode[] = fromUrl ? [fromUrl] : [];
  try {
    if (tab?.id !== undefined) codes = [...codes, ...(await sendToTab(tab.id, { type: 'GET_PAGE_CODES' })).codes];
  } catch {
    // No content script here (chrome:// pages, Web Store, or a tab opened before install).
  }
  return [...new Map(codes.map((code) => [formatCode(code), code])).values()];
}

function renderPageCodes(codes: VideoCode[]) {
  empty.hidden = codes.length > 0;
  onPage = new Set(codes.map(formatCode));
  $('codes-count').textContent = codes.length ? String(codes.length) : '';
  list.replaceChildren(...codes.map((code) => codeRow(code, codeLabel(code), tabPage)));
}

let sites: OpenOnSite[] = [];

/** A row of "Open on" site buttons for the code `getCode()` returns (null = nothing to open). */
function siteRow(getCode: () => VideoCode | null, label?: string): HTMLDivElement {
  const row = Object.assign(document.createElement('div'), { className: 'site-row' });
  if (label) row.append(Object.assign(document.createElement('span'), { className: 'label', textContent: label }));
  const go = (targets: OpenOnSite[]) => {
    const code = getCode();
    if (code) void openLinks(targets.map((s) => fillTemplate(s.template, code)));
  };
  for (const site of sites) row.append(textButton(site.name, 'chip', () => go([site])));
  if (sites.length > 1) row.append(textButton(`All ${sites.length}`, 'chip all', () => go(sites)));
  return row;
}

/** Site buttons under the code box, shown once the typed text is a code. */
function setupTypedSites() {
  const row = $('typed-sites');
  if (!sites.length) return;
  row.replaceChildren(...siteRow(() => parseCode(input.value), 'Open on').childNodes);
  const update = () => (row.hidden = !parseCode(input.value));
  input.addEventListener('input', update);
  update();
}

/** Opened by the background (next to this tab), so the pop-up blocker knows they're ours. */
async function openLinks(urls: string[]) {
  await sendToBackground({ type: 'OPEN_URLS', urls });
  window.close();
}

// Which groups are collapsed is a per-browser convenience, so localStorage is enough.
const COLLAPSED_KEY = 'collapsedGroups';
function collapsedGroups(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}
function setCollapsed(group: string, collapsed: boolean) {
  const set = collapsedGroups();
  if (collapsed) set.add(group);
  else set.delete(group);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable; collapsing just won't be remembered.
  }
}

function linkChip({ name, url }: QuickLink) {
  const a = Object.assign(document.createElement('a'), { className: 'chip', href: url, textContent: name, title: url });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void openLinks([url]);
  });
  return a;
}

function renderLinks(state: LinkState) {
  const container = $('links');
  container.replaceChildren();
  $('links-empty').hidden = state.quickLinks.length > 0;
  const collapsed = collapsedGroups();

  for (const { group, links } of groupLinks(state)) {
    if (links.length === 0) continue; // empty groups only show in Settings / the group picker
    if (group === null) {
      const row = Object.assign(document.createElement('div'), { className: 'links' });
      row.append(...links.map(linkChip));
      container.append(row);
      continue;
    }
    const details = Object.assign(document.createElement('details'), { className: 'group', open: !collapsed.has(group) });
    const summary = document.createElement('summary');
    const chev = icon('chevronRight', 14);
    chev.classList.add('chev');
    summary.append(
      chev,
      group,
      Object.assign(document.createElement('span'), { className: 'count', textContent: `${links.length}` }),
    );
    if (links.length > 1) {
      const all = textButton('Open all', 'link-btn open-all', () => {
        if (links.length <= 8 || confirm(`Open ${links.length} tabs?`)) void openLinks(links.map((l) => l.url));
      });
      all.addEventListener('click', (e) => e.preventDefault()); // don't toggle the <details>
      summary.append(all);
    }
    details.addEventListener('toggle', () => setCollapsed(group, !details.open));
    const body = Object.assign(document.createElement('div'), { className: 'group-links' });
    body.append(...links.map(linkChip));
    details.append(summary, body);
    container.append(details);
  }
}

const NEW_GROUP = '\u0000new';

/** "+ Add this page": activeTab gives us the current tab's URL/title while the popup is open. */
function setupAddPage(state: LinkState, tab: chrome.tabs.Tab | undefined) {
  const btn = $<HTMLButtonElement>('add-page');
  const form = $<HTMLFormElement>('add-page-form');
  const select = $<HTMLSelectElement>('add-page-group');
  const newGroup = $<HTMLInputElement>('add-page-new-group');
  const addError = $<HTMLParagraphElement>('add-page-error');

  const url = tab?.url && /^https?:/.test(tab.url) ? normalizeUrl(tab.url) : null;
  if (!tab || !url) {
    btn.hidden = true;
    return;
  }
  const mark = (added: boolean) => {
    btn.disabled = added;
    btn.replaceChildren(icon(added ? 'check' : 'plus', 14), added ? 'Added' : 'Add this page');
  };
  mark(state.quickLinks.some((l) => l.url === url));

  const showForm = (show: boolean) => {
    form.hidden = !show;
    addError.hidden = true;
    btn.hidden = show;
  };

  btn.addEventListener('click', () => {
    select.replaceChildren(
      new Option('No group', ''),
      ...state.linkGroups.map((g) => new Option(g, g)),
      new Option('+ New group…', NEW_GROUP),
    );
    newGroup.hidden = true;
    newGroup.value = '';
    showForm(true);
    select.focus();
  });
  select.addEventListener('change', () => {
    newGroup.hidden = select.value !== NEW_GROUP;
    if (!newGroup.hidden) newGroup.focus();
  });
  $('add-page-cancel').addEventListener('click', () => showForm(false));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const latest = await getSettings();
    let next: LinkState = { quickLinks: latest.quickLinks, linkGroups: latest.linkGroups };
    let group = select.value;
    if (group === NEW_GROUP) {
      const problem = validateGroupName(next.linkGroups, newGroup.value);
      if (problem) {
        addError.textContent = problem;
        addError.hidden = false;
        return;
      }
      group = newGroup.value.trim();
      next = addGroup(next, group);
    }
    const name = tab.title?.trim().slice(0, 60) || defaultLinkName(url);
    next = { ...next, quickLinks: [...next.quickLinks, { name, url, ...(group && { group }) }] };
    await setSettings(next);
    state = next;
    renderLinks(next);
    showForm(false);
    mark(true);
  });
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
    ['site-video', 'videoSites', false],
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
  $('reload-tab').addEventListener('click', async () => {
    if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
    window.close();
  });
}

/** Wait this long for the page's codes before picking the starting tab without them. */
const CODES_WAIT_MS = 400;

async function init() {
  setupTabs();
  const [settings, [tab]] = await Promise.all([
    getSettings(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const codesReady = pageCodes(tab); // ask the page now, while the rest renders

  sites = settings.openOnSites;
  tabPage = tab?.url && /^https?:/.test(tab.url) ? { url: tab.url, title: tab.title } : null;
  setupTypedSites();
  await renderFavourites(); // before the page's codes, so their stars are right
  onFavouritesChanged(() => void renderFavourites());
  favsFilter.addEventListener('input', paintFavList);
  setupStarPage();
  setupTypedStar();
  setupSiteToggles(settings, tab);

  const linkState: LinkState = { quickLinks: settings.quickLinks, linkGroups: settings.linkGroups };
  renderLinks(linkState);
  setupAddPage(linkState, tab);

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
