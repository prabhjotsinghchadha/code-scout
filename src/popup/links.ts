// The popup's Links tab: the sites opened most as a row of big icons, then the quick links as rows under
// their group (a group folds away; which ones are folded is remembered). Drag a row by its handle to
// reorder it or move it to another group; right-click it (or use its ⋯) to rename, move or remove it. The
// box at the top of the popup finds links by name, address or group (findLinks).
import { icon } from '../shared/icons';
import { openMenu } from '../shared/menu';
import {
  addGroup,
  appendLink,
  groupLinks,
  groupOf,
  linkLabel,
  placeLink,
  suggestLinkName,
  validateGroupName,
  type LinkState,
  type QuickLink,
} from '../shared/quick-links';
import { siteIcon } from '../shared/site-icon';
import { SITES } from '../shared/sites';
import { defaultLinkName, getSettings, normalizeUrl, setSettings, type Settings } from '../shared/storage';
import { mostVisitedLinks, VISITS_KEY, type Visits } from '../shared/visits';
import { sortButton } from './rows';
import { LINK_SORTS, sortLinks, storedSort, storeSort, type LinkSort } from './sort';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}) =>
  Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];

/** What the links without a group are called. */
const OTHER = 'Other links';
/** The groups folded away ("" = the links without a group), a per-browser convenience kept in localStorage. */
const FOLDED_KEY = 'linksFolded';
/** The group "Add page" last saved to. */
const LAST_GROUP_KEY = 'linksGroup';
/** Ask before opening more tabs than this at once. */
const CONFIRM_OVER = 8;

let state: LinkState = { quickLinks: [], linkGroups: [] };
let visits: Visits = {};
let showMostVisited = true;
let sort: LinkSort = 'mine';
let folded = new Set<string>();
let openLinks: (urls: string[]) => unknown = () => {};
/** Called after every change, e.g. to update "Add page". */
let onChange = () => {};
/** The link being dragged (its URL), while a drag is on. */
let dragging: string | null = null;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; it just won't be remembered.
  }
}

function storedFolded(): Set<string> {
  try {
    const list: unknown = JSON.parse(stored(FOLDED_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((g): g is string => typeof g === 'string') : []);
  } catch {
    return new Set();
  }
}

function setFolded(group: string, fold: boolean) {
  if (fold) folded.add(group);
  else folded.delete(group);
  store(FOLDED_KEY, JSON.stringify([...folded]));
  render();
}

/** Lower case, without spaces and dashes, so "english sub" finds "English subtitle". */
const squash = (s: string) => s.toLowerCase().replace(/[\s\-·]/g, '');

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

// --- Rows ---
/** Renames in place. `pageOnly` selects just the page's part of "Site · Page", ready to type over. */
function renameRow(row: HTMLElement, link: QuickLink, pageOnly = false) {
  const title = row.querySelector<HTMLElement>('.link-title')!;
  const input = el('input', { type: 'text', className: 'link-rename', value: link.name, maxLength: 80 });
  input.setAttribute('aria-label', 'Link name');
  title.replaceWith(input);
  row.querySelector('.link-host')?.remove();
  input.focus();
  const dot = link.name.indexOf(' · ');
  if (pageOnly && dot > 0) input.setSelectionRange(dot + 3, link.name.length);
  else input.select();
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

/** After "Add page": shows the new link's row and opens its name to edit, so it can say what the page is. */
function renameAdded(link: QuickLink) {
  const group = groupOf(state, link) ?? '';
  if (folded.has(group)) setFolded(group, false);
  else render();
  const row = [...$('links').querySelectorAll<HTMLAnchorElement>('.link-row > .link-main')]
    .find((a) => a.getAttribute('href') === link.url)
    ?.closest<HTMLElement>('.link-row');
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  renameRow(row, link, true);
}

function removeLink(link: QuickLink) {
  const before = state;
  void commit({ ...state, quickLinks: state.quickLinks.filter((l) => l.url !== link.url) });
  showUndo(`Removed “${linkLabel(link).title}”`, () => void commit(before));
}

function rowMenu(row: HTMLElement, link: QuickLink, at: DOMRect | { x: number; y: number }, opener?: HTMLElement) {
  const current = groupOf(state, link);
  openMenu(
    at,
    [
      { label: 'Open', icon: 'external', onClick: () => void openLinks([link.url]) },
      { label: 'Rename', icon: 'pencil', onClick: () => renameRow(row, link) },
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

/**
 * A link's row: its site's icon, the page's name, the site, and ⋯. `movable`: with a handle to drag it by
 * (only it starts a drag: the row is made draggable while the handle is held, as in Settings).
 */
function linkRow(link: QuickLink, movable = false): HTMLLIElement {
  const { title, host } = linkLabel(link);
  const row = el('li', { className: 'link-row' });
  row.dataset.url = link.url;
  const a = el('a', { className: 'link-main', href: link.url, title: `${link.name}\n${link.url}` });
  a.append(siteIcon(link, 18), el('span', { className: 'link-title', textContent: title }), el('span', { className: 'link-host', textContent: host }));
  const open = (e: MouseEvent) => {
    e.preventDefault();
    void openLinks([link.url]);
  };
  a.addEventListener('click', open);
  a.addEventListener('auxclick', (e) => e.button === 1 && open(e));
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    rowMenu(row, link, { x: e.clientX, y: e.clientY }, a);
  });
  a.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      rowMenu(row, link, a.getBoundingClientRect(), a);
    }
  });
  a.draggable = false; // the row is dragged by its handle, not as a link
  const more = el('button', { type: 'button', className: 'icon-btn quiet link-more', title: 'Rename, move or remove' });
  more.setAttribute('aria-label', `More for ${title}`);
  more.append(icon('more', 14));
  more.addEventListener('click', () => rowMenu(row, link, more.getBoundingClientRect(), more));

  if (movable) {
    const grip = el('span', { className: 'link-grip quiet', title: 'Drag to reorder, or onto another group' });
    grip.setAttribute('aria-hidden', 'true');
    grip.append(icon('grip', 14));
    grip.addEventListener('pointerdown', () => {
      row.draggable = true;
      addEventListener('pointerup', () => (row.draggable = false), { once: true });
    });
    row.addEventListener('dragstart', (e) => {
      dragging = link.url;
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', link.url);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      endDrag();
    });
    row.append(grip);
  }
  row.append(a, more);
  return row;
}

// --- Dragging a row: onto a row (before or after it) or onto a group's card (to its end) ---
function clearDropMarks() {
  $('links')
    .querySelectorAll('.drop-before, .drop-after, .drop-into')
    .forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
}

function endDrag() {
  dragging = null;
  clearDropMarks();
  $('links')
    .querySelectorAll('.dragging')
    .forEach((n) => n.classList.remove('dragging'));
}

/** Where a drop at this point would put the dragged link: what to mark, and the list it would make. */
function dropTarget(e: DragEvent): { mark: HTMLElement; className: string; next: LinkState } | null {
  if (!dragging) return null;
  const over = e.target instanceof Element ? e.target : null;
  const card = over?.closest<HTMLElement>('.link-group');
  if (!card) return null;
  const group = card.dataset.group || null;
  const row = over?.closest<HTMLElement>('.link-row');
  if (row?.dataset.url && row.dataset.url !== dragging) {
    const r = row.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    // After a row is before the next one; after the last one is the end of the group.
    const before = after ? (row.nextElementSibling as HTMLElement | null)?.dataset.url ?? null : row.dataset.url;
    if (before === dragging) return null; // where it already is
    return { mark: row, className: after ? 'drop-after' : 'drop-before', next: placeLink(state, dragging, group, before) };
  }
  if (row) return null; // over itself
  return { mark: card, className: 'drop-into', next: placeLink(state, dragging, group, null) };
}

function setupDrag() {
  const root = $('links');
  root.addEventListener('dragover', (e) => {
    const target = dropTarget(e);
    clearDropMarks();
    if (!target) return;
    e.preventDefault(); // a drop is allowed here
    e.dataTransfer!.dropEffect = 'move';
    target.mark.classList.add(target.className);
  });
  root.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) clearDropMarks();
  });
  root.addEventListener('drop', (e) => {
    const target = dropTarget(e);
    if (!target) return;
    e.preventDefault();
    endDrag();
    if (target.next !== state) void commit(target.next);
  });
}

// --- What's drawn ---
function rowList(links: QuickLink[], movable = false) {
  const ul = el('ul', { className: 'link-rows' });
  ul.append(...links.map((l) => linkRow(l, movable)));
  return ul;
}

/** "Most visited": a big icon and the site's name for each, one click away. */
function dial(links: QuickLink[]) {
  const box = el('div', { className: 'dial' });
  box.setAttribute('aria-label', 'Most visited');
  for (const link of links) {
    const name = link.name.split(' · ')[0] || linkLabel(link).host;
    const a = el('a', { className: 'dial-item link-main', href: link.url, title: `${name}\n${link.url}` });
    a.append(siteIcon(link, 28), el('span', { className: 'dial-name', textContent: name }));
    const open = (e: MouseEvent) => {
      e.preventDefault();
      void openLinks([link.url]);
    };
    a.addEventListener('click', open);
    a.addEventListener('auxclick', (e) => e.button === 1 && open(e));
    box.append(a);
  }
  return box;
}

/** A group's card: its name (click to fold it away), how many, Open all, and its rows. */
function groupCard(group: string | null, links: QuickLink[]) {
  const key = group ?? '';
  const isFolded = folded.has(key);
  const card = el('section', { className: 'link-group' });
  card.dataset.group = key;
  const head = el('div', { className: 'link-group-head' });
  const toggle = el('button', { type: 'button', className: 'link-group-toggle' });
  toggle.setAttribute('aria-expanded', String(!isFolded));
  toggle.title = isFolded ? 'Show these links' : 'Fold these links away';
  toggle.append(
    icon(isFolded ? 'chevronRight' : 'chevronDown', 14),
    el('span', { className: 'link-group-name', textContent: group ?? OTHER }),
    el('span', { className: 'count', textContent: String(links.length) }),
  );
  toggle.addEventListener('click', () => setFolded(key, !isFolded));
  head.append(toggle);
  if (links.length > 1) {
    const all = el('button', { type: 'button', className: 'link-btn quiet', textContent: 'Open all' });
    all.title = `Open all ${links.length} in new tabs`;
    all.addEventListener('click', () => openAll(links));
    head.append(all);
  }
  card.append(head);
  if (!isFolded) card.append(rowList(sortLinks(links, sort, visits, Date.now()), sort === 'mine'));
  return card;
}

/** The links matching `text` as rows, for the popup's search box. Null if none do. */
export function findLinks(text: string): { list: HTMLElement; count: number } | null {
  const q = squash(text);
  const found = q ? state.quickLinks.filter((l) => matches(l, q)) : [];
  return found.length ? { list: rowList(found), count: found.length } : null;
}

/** Draws the Links tab. Left until the tab is on show: the rows read each site's icon. */
export function renderLinks() {
  render();
}

function render() {
  if ($('panel-links').hidden) return;
  const count = state.quickLinks.length;
  $('links-title').textContent = count === 1 ? '1 link' : `${count} links`;
  $('links-empty').hidden = count > 0;
  $('links-sort').hidden = count < 2;

  const out: HTMLElement[] = [];
  const top = showMostVisited ? mostVisitedLinks(state.quickLinks, visits, Date.now()) : [];
  if (top.length > 1) out.push(dial(top));
  const sections = groupLinks(state);
  // Named groups in their order (one with no links still shows, so links can be dragged into it), then
  // the links without a group.
  for (const s of sections) if (s.group !== null) out.push(groupCard(s.group, s.links));
  for (const s of sections) if (s.group === null && s.links.length) out.push(groupCard(null, s.links));
  $('links').replaceChildren(...out);
}

const NEW_GROUP = '\u0000new';

/** "Add this page": activeTab gives us the current tab's URL/title while the popup is open. */
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
    btn.replaceChildren(icon(added ? 'check' : 'plus', 14), added ? 'Page added' : 'Add this page');
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
    const last = stored(LAST_GROUP_KEY) ?? '';
    select.value = state.linkGroups.includes(last) ? last : ''; // the group saved to last time
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
    store(LAST_GROUP_KEY, group);
    const link: QuickLink = { name: suggestLinkName(url, tab.title ?? '', next.quickLinks, SITES), url, ...(group && { group }) };
    showForm(false);
    void commit(appendLink(next, link));
    renameAdded(link);
  });
}

export async function setupLinks(settings: Settings, tab: chrome.tabs.Tab | undefined, open: (urls: string[]) => unknown) {
  state = { quickLinks: settings.quickLinks, linkGroups: settings.linkGroups };
  showMostVisited = settings.mostVisited;
  openLinks = open;
  folded = storedFolded();
  sort = storedSort('links', LINK_SORTS);
  // For "Most visited" at the top, and for sorting by it.
  try {
    visits = (await chrome.storage.local.get<{ [VISITS_KEY]: Visits }>({ [VISITS_KEY]: {} }))[VISITS_KEY];
  } catch {
    visits = {};
  }

  sortButton($<HTMLButtonElement>('links-sort'), LINK_SORTS, () => sort, (value) => {
    sort = value;
    storeSort('links', value);
    render();
  });
  setupDrag();
  setupAddPage(tab);
  render();
}
