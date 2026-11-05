// Settings › Quick links. Each group is a card. Drag a link by its handle to reorder it or move it to
// another group, and drag a group by its handle to reorder the groups. Everything is also in the ⋯ menus,
// so it all works from the keyboard too.
import { icon } from '../shared/icons';
import { openMenu, type MenuItem } from '../shared/menu';
import {
  addGroup,
  appendLink,
  deleteGroup,
  groupLinks,
  groupOf,
  hasGroup,
  MAX_GROUP_NAME,
  placeGroup,
  placeLink,
  renameGroup,
  validateGroupName,
  type LinkState,
  type QuickLink,
} from '../shared/quick-links';
import { siteIcon } from '../shared/site-icon';
import { defaultLinkName, getSettings, normalizeUrl, type Settings } from '../shared/storage';
import { VISITS_KEY } from '../shared/visits';

type Save = (patch: Partial<Settings>) => Promise<void>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}) =>
  Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

let root: HTMLElement;
let state: LinkState = { quickLinks: [], linkGroups: [] };
let save: Save = async () => {};
/** The card whose "Add a link" form is open ("" = the links without a group), kept across re-renders. */
let adding: string | null = null;
let dragging: { kind: 'link'; url: string } | { kind: 'group'; name: string } | null = null;

/** A card's key: its group's name, or "" for the links without a group. */
const key = (group: string | null) => group ?? '';
const card = (group: string | null) =>
  root.querySelector<HTMLElement>(`.lgroup[data-group="${CSS.escape(key(group))}"]`);
const otherTitle = () => (state.linkGroups.length ? 'Other links' : 'Links');

async function commit(next: LinkState) {
  state = next;
  render();
  await save({ quickLinks: next.quickLinks, linkGroups: next.linkGroups });
}

function showError(box: HTMLElement | null, message: string | null) {
  const p = box?.querySelector<HTMLParagraphElement>(':scope > .error');
  if (!p) return;
  p.hidden = !message;
  p.textContent = message ?? '';
}

function moreButton(label: string, menu: (at: HTMLElement) => void) {
  const b = el('button', { type: 'button', className: 'icon-btn', title: label });
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-haspopup', 'menu');
  b.append(icon('more'));
  b.addEventListener('click', () => menu(b));
  return b;
}

/**
 * The drag handle. Only it starts a drag: the row or card is made draggable while the handle is held, so
 * the name boxes inside stay usable (text in a draggable element can't be selected).
 */
function grip(target: HTMLElement, label: string, start: () => NonNullable<typeof dragging>) {
  const g = el('span', { className: 'grip', title: label });
  g.append(icon('grip'));
  g.addEventListener('pointerdown', () => {
    target.draggable = true;
    addEventListener('pointerup', () => (target.draggable = false), { once: true });
  });
  target.addEventListener('dragstart', (e) => {
    if (e.target !== target) return;
    e.stopPropagation();
    dragging = start();
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', dragging.kind === 'link' ? dragging.url : dragging.name);
    target.classList.add('dragging');
    root.classList.add(`dragging-${dragging.kind}`);
  });
  target.addEventListener('dragend', () => {
    target.draggable = false;
    target.classList.remove('dragging');
    endDrag();
  });
  return g;
}

/** A name box that saves when you leave it or press Enter; Esc puts the old name back. */
function nameBox(value: string, label: string, maxLength: number, onSave: (value: string) => void) {
  const input = el('input', { type: 'text', className: 'inline-name', value, maxLength, title: 'Click to rename' });
  input.setAttribute('aria-label', label);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = value;
      input.blur();
    }
  });
  input.addEventListener('change', () => onSave(input.value));
  return input;
}

function focusName(box: HTMLElement | null) {
  const input = box?.querySelector<HTMLInputElement>('.inline-name');
  input?.focus();
  input?.select();
}

// --- Links ---
function linkMenu(link: QuickLink, siblings: QuickLink[], i: number, at: DOMRect | { x: number; y: number }, opener: HTMLElement) {
  const group = groupOf(state, link);
  const row = opener.closest<HTMLElement>('.lrow');
  const items: MenuItem[] = [
    { label: 'Open in a new tab', icon: 'external', onClick: () => void chrome.tabs.create({ url: link.url }) },
    { label: 'Rename', icon: 'pencil', onClick: () => focusName(row) },
    {
      label: 'Move up',
      icon: 'arrowUp',
      disabled: i === 0,
      onClick: () => void commit(placeLink(state, link.url, group, siblings[i - 1].url)),
    },
    {
      label: 'Move down',
      icon: 'arrowDown',
      disabled: i === siblings.length - 1,
      onClick: () => void commit(placeLink(state, link.url, group, siblings[i + 2]?.url ?? null)),
    },
    'separator',
    { heading: 'Move to' },
    ...[...state.linkGroups, null].map((g) => ({
      label: g ?? otherTitle(),
      checked: g === group,
      onClick: () => g !== group && void commit(placeLink(state, link.url, g, null)),
    })),
    'separator',
    {
      label: 'Remove link',
      icon: 'trash',
      danger: true,
      onClick: () => void commit({ ...state, quickLinks: state.quickLinks.filter((l) => l.url !== link.url) }),
    },
  ];
  openMenu(at, items, opener);
}

function linkRow(link: QuickLink, siblings: QuickLink[], i: number) {
  const li = el('li', { className: 'lrow' });
  li.dataset.url = link.url;
  const name = nameBox(link.name, 'Link name', 80, (value) => {
    const name = value.trim() || defaultLinkName(link.url);
    void commit({ ...state, quickLinks: state.quickLinks.map((l) => (l.url === link.url ? { ...l, name } : l)) });
  });
  const text = el('span', { className: 'lrow-text' });
  text.append(name, el('small', { textContent: link.url, title: link.url }));
  const more = moreButton(`More for ${link.name}`, (b) => linkMenu(link, siblings, i, b.getBoundingClientRect(), b));
  li.append(grip(li, 'Drag to move', () => ({ kind: 'link', url: link.url })), siteIcon(link, 18), text, more);
  li.addEventListener('contextmenu', (e) => {
    if (e.target instanceof HTMLInputElement) return; // keep the text box's own menu
    e.preventDefault();
    linkMenu(link, siblings, i, { x: e.clientX, y: e.clientY }, more);
  });
  return li;
}

/** "+ Add a link" under a card, which opens a small form in place. */
function addLink(group: string | null) {
  const wrap = el('div', { className: 'ladd' });
  if (adding !== key(group)) {
    const b = el('button', { type: 'button', className: 'link-btn' });
    b.append(icon('plus', 14), group === null ? 'Add a link' : `Add a link to ${group}`);
    b.addEventListener('click', () => {
      adding = key(group);
      render();
      card(group)?.querySelector<HTMLInputElement>('.ladd input')?.focus();
    });
    wrap.append(b);
    return wrap;
  }
  const form = el('form', { className: 'add' });
  const url = el('input', { type: 'text', placeholder: 'https://example.com/category/…', required: true });
  url.setAttribute('aria-label', 'Web address');
  const name = el('input', { type: 'text', className: 'narrow', placeholder: 'Name (optional)' });
  name.setAttribute('aria-label', 'Name');
  const submit = el('button', { type: 'submit', className: 'btn primary' });
  submit.append(icon('plus', 14), 'Add');
  const cancel = el('button', { type: 'button', className: 'btn ghost', textContent: 'Done' });
  const close = () => {
    adding = null;
    render();
  };
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const box = card(group);
    const link = normalizeUrl(url.value);
    if (!link) return showError(box, 'Enter a valid web address (http or https).');
    if (state.quickLinks.some((l) => l.url === link)) return showError(box, 'That link is already in your quick links.');
    void commit(appendLink(state, { name: name.value.trim() || defaultLinkName(link), url: link, ...(group && { group }) }));
    card(group)?.querySelector<HTMLInputElement>('.ladd input')?.focus(); // ready for the next one
  });
  form.append(url, name, submit, cancel);
  wrap.append(form);
  return wrap;
}

// --- Groups ---
function groupMenu(group: string, count: number, opener: HTMLElement) {
  const at = state.linkGroups.indexOf(group);
  openMenu(
    opener.getBoundingClientRect(),
    [
      { label: 'Rename', icon: 'pencil', onClick: () => focusName(card(group)?.querySelector('.lgroup-head') ?? null) },
      {
        label: 'Move up',
        icon: 'arrowUp',
        disabled: at === 0,
        onClick: () => void commit({ ...state, linkGroups: placeGroup(state.linkGroups, group, state.linkGroups[at - 1]) }),
      },
      {
        label: 'Move down',
        icon: 'arrowDown',
        disabled: at === state.linkGroups.length - 1,
        onClick: () =>
          void commit({ ...state, linkGroups: placeGroup(state.linkGroups, group, state.linkGroups[at + 2] ?? null) }),
      },
      'separator',
      {
        label: 'Delete group',
        icon: 'trash',
        danger: true,
        onClick: () => {
          const ok = !count || confirm(`Delete “${group}”? Its ${plural(count, 'link')} will move to Other links.`);
          if (ok) void commit(deleteGroup(state, group));
        },
      },
    ],
    opener,
  );
}

function groupCard(group: string | null, links: QuickLink[]) {
  const box = el('section', { className: `lgroup${group === null ? ' other' : ''}` });
  box.dataset.group = key(group);
  const head = el('div', { className: 'lgroup-head' });
  if (group === null) {
    head.append(icon('link'), el('strong', { className: 'lgroup-title', textContent: otherTitle() }));
  } else {
    const name = nameBox(group, 'Group name', MAX_GROUP_NAME, (value) => {
      const problem = validateGroupName(state.linkGroups, value, group);
      showError(box, problem);
      if (problem) name.value = group;
      else if (value.trim() !== group) void commit(renameGroup(state, group, value));
    });
    name.classList.add('group-name');
    head.append(grip(box, 'Drag to reorder groups', () => ({ kind: 'group', name: group })), name);
  }
  head.append(el('span', { className: 'count', textContent: plural(links.length, 'link') }));
  if (group !== null) head.append(moreButton(`More for ${group}`, (b) => groupMenu(group, links.length, b)));

  const list = el('ul', { className: 'rows lrows' });
  list.append(...links.map((link, i) => linkRow(link, links, i)));
  box.append(head, list);
  if (!links.length) {
    box.append(
      el('p', {
        className: 'ldrop-empty',
        textContent: group === null ? 'Links without a group show here. Drag one here to take it out of its group.' : 'Drag links here, or add one.',
      }),
    );
  }
  box.append(addLink(group), el('p', { className: 'error', hidden: true }));
  return box;
}

function render() {
  const sections = groupLinks(state);
  const other = sections.find((s) => s.group === null)!;
  root.replaceChildren(
    ...sections.filter((s) => s.group !== null).map((s) => groupCard(s.group, s.links)),
    groupCard(null, other.links),
  );
}

// --- Dragging ---
function clearMarks() {
  root.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'drop-into'));
}

function endDrag() {
  dragging = null;
  clearMarks();
  root.classList.remove('dragging-link', 'dragging-group');
}

const above = (e: DragEvent, box: Element) => {
  const r = box.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2;
};

/** Where a drop at this point would put the thing being dragged: how to mark it, and the change. */
function dropAt(e: DragEvent): { mark: () => void; apply: () => LinkState } | null {
  const over = (e.target as Element).closest?.<HTMLElement>('.lgroup');
  if (!dragging || !over) return null;
  if (dragging.kind === 'link') {
    const { url } = dragging;
    const group = over.dataset.group || null;
    const rows = [...over.querySelectorAll<HTMLElement>('.lrow')].filter((r) => r.dataset.url !== url);
    const before = rows.find((r) => above(e, r));
    return {
      mark: () => (before ?? rows.at(-1) ?? over).classList.add(before ? 'drop-before' : rows.length ? 'drop-after' : 'drop-into'),
      apply: () => placeLink(state, url, group, before?.dataset.url ?? null),
    };
  }
  const { name } = dragging;
  const cards = [...root.querySelectorAll<HTMLElement>('.lgroup:not(.other)')].filter((c) => c.dataset.group !== name);
  if (!cards.length) return null;
  const before = cards.find((c) => above(e, c));
  return {
    mark: () => (before ?? cards.at(-1)!).classList.add(before ? 'drop-before' : 'drop-after'),
    apply: () => ({ ...state, linkGroups: placeGroup(state.linkGroups, name, before?.dataset.group ?? null) }),
  };
}

function setupDragging() {
  root.addEventListener('dragover', (e) => {
    const target = dropAt(e);
    clearMarks();
    if (!target) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    target.mark();
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) clearMarks();
  });
  root.addEventListener('drop', (e) => {
    const target = dropAt(e);
    if (!target) return;
    e.preventDefault();
    const next = target.apply();
    endDrag();
    void commit(next);
  });
}

// --- Setup ---
function newGroupName() {
  let name = 'New group';
  for (let n = 2; hasGroup(state.linkGroups, name); n++) name = `New group ${n}`;
  return name;
}

/** Whether the user is typing in the editor, so a reload from storage would get in the way. */
const editing = () => document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement);

export async function setupLinksEditor(saveSettings: Save, notify: (text: string) => void) {
  root = document.getElementById('link-groups')!;
  save = saveSettings;
  const load = async () => {
    const s = await getSettings();
    state = { quickLinks: s.quickLinks, linkGroups: s.linkGroups };
    render();
    return s;
  };
  const settings = await load();
  setupDragging();

  document.getElementById('new-group')!.addEventListener('click', () => {
    const name = newGroupName();
    void commit(addGroup(state, name));
    const box = card(name);
    box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    focusName(box?.querySelector('.lgroup-head') ?? null);
  });

  const mostVisited = document.getElementById('mostVisited') as HTMLInputElement;
  mostVisited.checked = settings.mostVisited;
  mostVisited.addEventListener('change', () => save({ mostVisited: mostVisited.checked }));
  document.getElementById('clear-visits')!.addEventListener('click', async () => {
    await chrome.storage.local.remove(VISITS_KEY);
    notify('Visit history cleared');
  });

  // Pick up links added from the popup while this page is open (but not mid-rename or mid-drag).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if ((changes.quickLinks || changes.linkGroups) && !editing() && !dragging) void load();
    if (changes.mostVisited) mostVisited.checked = changes.mostVisited.newValue !== false;
  });
}
