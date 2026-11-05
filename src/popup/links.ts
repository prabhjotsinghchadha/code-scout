// The popup's Links tab: search, group pills, "Most visited", and the quick links as tiles. Right-click a
// tile (or use its ⋯) to rename it, move it to another group or remove it.
import { icon, type IconName } from '../shared/icons';
import { openMenu } from '../shared/menu';
import {
  addGroup,
  appendLink,
  groupLinks,
  groupOf,
  linkLabel,
  placeLink,
  validateGroupName,
  type LinkState,
  type QuickLink,
} from '../shared/quick-links';
import { siteIcon } from '../shared/site-icon';
import { defaultLinkName, getSettings, normalizeUrl, setSettings, type Settings } from '../shared/storage';
import { mostVisitedLinks, VISITS_KEY, type Visits } from '../shared/visits';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}) =>
  Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];

/** What the links without a group are called. */
const OTHER = 'Other links';
/** The pill picked last ("" = All), a per-browser convenience kept in localStorage. */
const PILL_KEY = 'linksGroup';
const ALL = '';
/** Ask before opening more tabs than this at once. */
const CONFIRM_OVER = 8;

let state: LinkState = { quickLinks: [], linkGroups: [] };
let visits: Visits = {};
let showMostVisited = true;
let pill = ALL;
let openLinks: (urls: string[]) => unknown = () => {};
/** Called after every change, e.g. to update "Add page". */
let onChange = () => {};

function storedPill(): string {
  try {
    return localStorage.getItem(PILL_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}
function setPill(group: string) {
  pill = group;
  try {
    localStorage.setItem(PILL_KEY, group);
  } catch {
    // Storage unavailable; the pill just won't be remembered.
  }
  render();
}

/** Lower case, without spaces and dashes, so "english sub" finds "English subtitle". */
const squash = (s: string) => s.toLowerCase().replace(/[\s\-·]/g, '');
const query = () => squash($<HTMLInputElement>('links-search').value);

function matches(link: QuickLink, q: string) {
  return [link.name, link.url, groupOf(state, link) ?? OTHER].some((s) => squash(s).includes(q));
}

async function commit(next: LinkState) {
  state = next;
  render();
  onChange();
  await setSettings({ quickLinks: next.quickLinks, linkGroups: next.linkGroups });
}

function openAll(links: QuickLink[]) {
  if (links.length <= CONFIRM_OVER || confirm(`Open ${links.length} tabs?`)) void openLinks(links.map((l) => l.url));
}

// --- Undo bar for removed links ---
let undoTimer: number | undefined;
function showUndo(text: string, undo: () => void) {
  let bar = document.getElementById('undo-bar');
  if (!bar) {
    bar = el('div', { id: 'undo-bar', className: 'toast undo' });
    bar.setAttribute('role', 'status');
    document.body.append(bar);
  }
  const button = el('button', { type: 'button', className: 'link-btn', textContent: 'Undo' });
  button.addEventListener('click', () => {
    clearTimeout(undoTimer);
    bar.classList.remove('show');
    undo();
  });
  bar.replaceChildren(el('span', { textContent: text }), button);
  bar.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => bar.classList.remove('show'), 5000);
}

// --- Tiles ---
function renameTile(tile: HTMLElement, link: QuickLink) {
  const title = tile.querySelector<HTMLElement>('.tile-title')!;
  const input = el('input', { type: 'text', className: 'tile-rename', value: link.name, maxLength: 80 });
  input.setAttribute('aria-label', 'Link name');
  title.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim() || defaultLinkName(link.url);
    if (save && name !== link.name) {
      void commit({ ...state, quickLinks: state.quickLinks.map((l) => (l.url === link.url ? { ...l, name } : l)) });
    } else {
      render();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') {
      e.preventDefault(); // keep the popup open
      finish(false);
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  // Clicks in the box shouldn't open the link.
  input.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

function removeLink(link: QuickLink) {
  const before = state;
  void commit({ ...state, quickLinks: state.quickLinks.filter((l) => l.url !== link.url) });
  showUndo(`Removed “${linkLabel(link).title}”`, () => void commit(before));
}

function tileMenu(tile: HTMLElement, link: QuickLink, at: DOMRect | { x: number; y: number }, opener?: HTMLElement) {
  const current = groupOf(state, link);
  openMenu(
    at,
    [
      { label: 'Open', icon: 'external', onClick: () => void openLinks([link.url]) },
      { label: 'Rename', icon: 'pencil', onClick: () => renameTile(tile, link) },
      'separator',
      { heading: 'Move to' },
      ...[...state.linkGroups, null].map((g) => ({
        label: g ?? OTHER,
        checked: g === current,
        onClick: () => void commit(placeLink(state, link.url, g, null)),
      })),
      'separator',
      { label: 'Remove', icon: 'trash', danger: true, onClick: () => removeLink(link) },
    ],
    opener,
  );
}

/** A link's tile. `bySite` titles it with the site's name ("FapHouse") rather than the page's ("Japanese"). */
function tile(link: QuickLink, bySite = false): HTMLDivElement {
  const { host, ...label } = linkLabel(link);
  const title = bySite ? link.name.split(' · ')[0] : label.title;
  const box = el('div', { className: 'tile' });
  const a = el('a', { className: 'tile-link', href: link.url, title: `${link.name}\n${link.url}` });
  const text = el('span', { className: 'tile-text' });
  text.append(el('span', { className: 'tile-title', textContent: title }), el('span', { className: 'tile-host', textContent: host }));
  a.append(siteIcon(link, 18), text);
  const open = (e: MouseEvent) => {
    e.preventDefault();
    void openLinks([link.url]);
  };
  a.addEventListener('click', open);
  a.addEventListener('auxclick', (e) => e.button === 1 && open(e));
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(box, link, { x: e.clientX, y: e.clientY }, a);
  });
  a.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      tileMenu(box, link, a.getBoundingClientRect(), a);
    }
  });
  const more = el('button', { type: 'button', className: 'tile-more', title: 'Rename, move or remove' });
  more.setAttribute('aria-label', `More for ${title}`);
  more.append(icon('more', 14));
  more.addEventListener('click', () => tileMenu(box, link, more.getBoundingClientRect(), more));
  box.append(a, more);
  return box;
}

function grid(links: QuickLink[], bySite = false) {
  const g = el('div', { className: 'tile-grid' });
  g.append(...links.map((l) => tile(l, bySite)));
  return g;
}

function section(title: string, links: QuickLink[], opts: { icon?: IconName; openAll?: boolean; bySite?: boolean } = {}) {
  const box = el('section', { className: 'link-section' });
  const head = el('div', { className: 'section-head' });
  if (opts.icon) head.append(icon(opts.icon, 14));
  head.append(el('span', { className: 'section-title', textContent: title }));
  head.append(el('span', { className: 'count', textContent: String(links.length) }));
  if (opts.openAll !== false && links.length > 1) {
    const all = el('button', { type: 'button', className: 'link-btn', textContent: 'Open all' });
    all.title = `Open all ${links.length} in new tabs`;
    all.addEventListener('click', () => openAll(links));
    head.append(all);
  }
  box.append(head, grid(links, opts.bySite));
  return box;
}

function pillButton(label: string, count: number, value: string) {
  const b = el('button', { type: 'button', className: 'gpill' });
  b.setAttribute('aria-pressed', String(pill === value));
  b.append(label, el('span', { className: 'count', textContent: String(count) }));
  b.addEventListener('click', () => setPill(value));
  return b;
}

/** Scrolls the pill row (it scrolls sideways) so the chosen pill shows. */
function pillInView() {
  const pills = $('group-pills');
  const active = pills.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!active || !pills.clientWidth) return; // not laid out yet: the tab is hidden
  const left = active.offsetLeft - pills.offsetLeft;
  if (left < pills.scrollLeft || left + active.offsetWidth > pills.scrollLeft + pills.clientWidth) pills.scrollLeft = left - 24;
}

export function render() {
  const sections = groupLinks(state).filter((s) => s.links.length);
  const named = sections.filter((s) => s.group !== null);
  const other = sections.find((s) => s.group === null);
  const q = query();
  if (pill !== ALL && !named.some((s) => s.group === pill)) pill = ALL;

  $('links-empty').hidden = state.quickLinks.length > 0;
  const pills = $('group-pills');
  pills.hidden = !!q || named.length === 0;
  pills.replaceChildren(
    pillButton('All', state.quickLinks.length, ALL),
    ...named.map((s) => pillButton(s.group!, s.links.length, s.group!)),
  );
  pillInView();

  const out: HTMLElement[] = [];
  if (q) {
    const found = state.quickLinks.filter((l) => matches(l, q));
    if (found.length) out.push(grid(found));
    $('links-none').hidden = found.length > 0;
  } else {
    $('links-none').hidden = true;
    if (pill !== ALL) {
      const s = named.find((x) => x.group === pill)!;
      out.push(section(s.group!, s.links));
    } else {
      const top = showMostVisited ? mostVisitedLinks(state.quickLinks, visits, Date.now()) : [];
      if (top.length) out.push(section('Most visited', top, { icon: 'trending', openAll: false, bySite: true }));
      for (const s of named) out.push(section(s.group!, s.links));
      if (other) out.push(named.length || top.length ? section(OTHER, other.links) : grid(other.links));
    }
  }
  $('links').replaceChildren(...out);
}

const NEW_GROUP = '\u0000new';

/** "Add page": activeTab gives us the current tab's URL/title while the popup is open. */
function setupAddPage(tab: chrome.tabs.Tab | undefined) {
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
  const mark = () => {
    const added = state.quickLinks.some((l) => l.url === url);
    btn.disabled = added;
    btn.title = added ? 'This page is in your quick links' : 'Save the page you’re on as a quick link';
    btn.replaceChildren(icon(added ? 'check' : 'plus', 14), added ? 'Added' : 'Add page');
  };
  mark();
  onChange = mark;

  const showForm = (show: boolean) => {
    form.hidden = !show;
    addError.hidden = true;
    btn.hidden = show;
  };

  btn.addEventListener('click', () => {
    select.replaceChildren(
      new Option(`No group (${OTHER})`, ''),
      ...state.linkGroups.map((g) => new Option(g, g)),
      new Option('+ New group…', NEW_GROUP),
    );
    select.value = pill; // the group being looked at
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
    showForm(false);
    await commit(appendLink(next, { name, url, ...(group && { group }) }));
  });
}

export async function setupLinks(settings: Settings, tab: chrome.tabs.Tab | undefined, open: (urls: string[]) => unknown) {
  state = { quickLinks: settings.quickLinks, linkGroups: settings.linkGroups };
  showMostVisited = settings.mostVisited;
  openLinks = open;
  pill = storedPill();
  if (showMostVisited) {
    try {
      visits = (await chrome.storage.local.get<{ [VISITS_KEY]: Visits }>({ [VISITS_KEY]: {} }))[VISITS_KEY];
    } catch {
      visits = {};
    }
  }

  // The Links tab may be hidden at first; once it shows, bring the chosen pill into view.
  new ResizeObserver(pillInView).observe($('group-pills'));
  // A mouse wheel scrolls the pill row sideways.
  $('group-pills').addEventListener(
    'wheel',
    (e) => {
      const row = e.currentTarget as HTMLElement;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    },
    { passive: false },
  );

  const search = $<HTMLInputElement>('links-search');
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = state.quickLinks.find((l) => matches(l, query()));
      if (first && query()) void openLinks([first.url]);
    } else if (e.key === 'Escape' && search.value) {
      e.preventDefault(); // clear the search, don't close the popup
      search.value = '';
      render();
    }
  });
  setupAddPage(tab);
  render();
}
