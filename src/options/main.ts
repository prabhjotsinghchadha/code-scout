import type { OpenMode } from '../shared/codes';
import { siteKey } from '../shared/hosts';
import {
  newSiteId,
  PLACEHOLDERS,
  siteNameFromTemplate,
  validateTemplate,
  fillTemplate,
  type OpenOnSite,
} from '../shared/open-on';
import {
  addGroup,
  deleteGroup,
  groupLinks,
  moveItem,
  renameGroup,
  setLinkGroup,
  validateGroupName,
  type LinkState,
} from '../shared/quick-links';
import { defaultLinkName, getSettings, normalizeUrl, setSettings, type Settings } from '../shared/storage';

const status = document.getElementById('status') as HTMLParagraphElement;
const inlineButtons = document.getElementById('inlineButtons') as HTMLInputElement;
const fieldChip = document.getElementById('fieldChip') as HTMLInputElement;
const openInBackground = document.getElementById('openInBackground') as HTMLInputElement;
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="openMode"]');

let timer: number | undefined;
async function save(patch: Partial<Settings>) {
  await setSettings(patch);
  status.textContent = 'Saved.';
  clearTimeout(timer);
  timer = window.setTimeout(() => (status.textContent = ''), 1200);
}

async function init() {
  const settings = await getSettings();
  inlineButtons.checked = settings.inlineButtons;
  fieldChip.checked = settings.fieldChip;
  openInBackground.checked = settings.openInBackground;
  modeRadios.forEach((r) => (r.checked = r.value === settings.openMode));

  inlineButtons.addEventListener('change', () => save({ inlineButtons: inlineButtons.checked }));
  fieldChip.addEventListener('change', () => save({ fieldChip: fieldChip.checked }));
  openInBackground.addEventListener('change', () => save({ openInBackground: openInBackground.checked }));
  modeRadios.forEach((r) =>
    r.addEventListener('change', () => r.checked && save({ openMode: r.value as OpenMode })),
  );
}

// --- Quick links & groups ---
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const groupList = $<HTMLUListElement>('groups');
const groupName = $<HTMLInputElement>('group-name');
const groupError = $<HTMLParagraphElement>('group-error');
const linkList = $<HTMLUListElement>('links');
const linkUrl = $<HTMLInputElement>('link-url');
const linkName = $<HTMLInputElement>('link-name');
const linkGroup = $<HTMLSelectElement>('link-group');
const linkError = $<HTMLParagraphElement>('link-error');
let state: LinkState = { quickLinks: [], linkGroups: [] };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function actionButton(label: string, title: string, onClick: () => void, disabled = false) {
  const b = el('button', { type: 'button', textContent: label, title, disabled });
  b.addEventListener('click', onClick);
  return b;
}

function groupSelect(selected: string | undefined) {
  const select = el('select');
  select.append(new Option('No group', ''), ...state.linkGroups.map((g) => new Option(g, g)));
  select.value = selected && state.linkGroups.includes(selected) ? selected : '';
  return select;
}

function showError(target: HTMLParagraphElement, message: string | null) {
  target.hidden = !message;
  target.textContent = message ?? '';
}

function render() {
  const counts = new Map(groupLinks(state).map((s) => [s.group, s.links.length]));

  groupList.replaceChildren(
    ...state.linkGroups.map((group, i) => {
      const name = el('input', { className: 'inline-name', value: group, maxLength: 30, title: 'Click to rename' });
      name.addEventListener('change', () => {
        const problem = validateGroupName(state.linkGroups, name.value, group);
        showError(groupError, problem);
        if (problem) {
          name.value = group;
          return;
        }
        if (name.value.trim() !== group) void commit(renameGroup(state, group, name.value));
      });
      const n = counts.get(group) ?? 0;
      const li = el('li');
      li.append(
        el('span', {}),
        el('span', { className: 'count', textContent: `${n} link${n === 1 ? '' : 's'}` }),
        actionButton('↑', 'Move up', () => commit({ ...state, linkGroups: moveItem(state.linkGroups, i, -1) }), i === 0),
        actionButton(
          '↓',
          'Move down',
          () => commit({ ...state, linkGroups: moveItem(state.linkGroups, i, 1) }),
          i === state.linkGroups.length - 1,
        ),
        actionButton('Delete', 'Delete group (its links are kept)', () => {
          if (n === 0 || confirm(`Delete “${group}”? Its ${n} link${n === 1 ? '' : 's'} will be kept without a group.`)) {
            void commit(deleteGroup(state, group));
          }
        }),
      );
      li.firstElementChild!.append(name);
      return li;
    }),
  );

  linkList.replaceChildren(
    ...state.quickLinks.map((link, i) => {
      const name = el('input', { className: 'inline-name', value: link.name, title: 'Click to rename' });
      name.addEventListener('change', () => {
        const value = name.value.trim() || defaultLinkName(link.url);
        const quickLinks = state.quickLinks.map((l, j) => (j === i ? { ...l, name: value } : l));
        void commit({ ...state, quickLinks });
      });
      const text = el('span');
      text.append(name, el('small', { textContent: link.url }));

      const select = groupSelect(link.group);
      select.addEventListener('change', () =>
        commit({ ...state, quickLinks: setLinkGroup(state.quickLinks, link.url, select.value || null) }),
      );

      const li = el('li');
      li.append(
        text,
        select,
        actionButton('↑', 'Move up', () => commit({ ...state, quickLinks: moveItem(state.quickLinks, i, -1) }), i === 0),
        actionButton(
          '↓',
          'Move down',
          () => commit({ ...state, quickLinks: moveItem(state.quickLinks, i, 1) }),
          i === state.quickLinks.length - 1,
        ),
        actionButton('Remove', 'Remove link', () =>
          commit({ ...state, quickLinks: state.quickLinks.filter((_, j) => j !== i) }),
        ),
      );
      return li;
    }),
  );

  // Keep the "add link" group picker in sync, preserving the current choice.
  const current = linkGroup.value;
  linkGroup.replaceChildren(...groupSelect(current).options);
  linkGroup.value = state.linkGroups.includes(current) ? current : '';
}

async function commit(next: LinkState) {
  state = next;
  render();
  await save(next);
}

$('add-group').addEventListener('submit', (e) => {
  e.preventDefault();
  const problem = validateGroupName(state.linkGroups, groupName.value);
  showError(groupError, problem);
  if (problem) return;
  void commit(addGroup(state, groupName.value));
  groupName.value = '';
});

$('add-link').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = normalizeUrl(linkUrl.value);
  if (!url) return showError(linkError, 'Enter a valid web address (http or https).');
  if (state.quickLinks.some((l) => l.url === url)) return showError(linkError, 'That link is already in the list.');
  showError(linkError, null);
  const group = linkGroup.value;
  const link = { name: linkName.value.trim() || defaultLinkName(url), url, ...(group && { group }) };
  void commit({ ...state, quickLinks: [...state.quickLinks, link] });
  linkUrl.value = '';
  linkName.value = '';
});

const loadLinks = () =>
  getSettings().then((s) => {
    state = { quickLinks: s.quickLinks, linkGroups: s.linkGroups };
    render();
  });
void loadLinks();
// Pick up links added from the popup while this page is open (but not while typing a rename).
chrome.storage.onChanged.addListener((changes) => {
  const editing = document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('inline-name');
  if ((changes.quickLinks || changes.linkGroups) && !editing) void loadLinks();
});

// --- Open on sites ---
const siteList = $<HTMLUListElement>('sites');
const siteTemplate = $<HTMLInputElement>('site-template');
const siteName = $<HTMLInputElement>('site-name');
const siteError = $<HTMLParagraphElement>('site-error');
let sites: OpenOnSite[] = [];
const SAMPLE = { prefix: 'nsfs', number: 484 };

$('placeholders').replaceChildren(
  ...PLACEHOLDERS.map(({ token, example, describe }) => {
    const li = el('li');
    li.append(el('code', { textContent: token }), ` → ${example} `, el('small', { textContent: `(${describe})` }));
    (li.lastChild as HTMLElement).style.display = 'inline';
    return li;
  }),
);

async function commitSites(next: OpenOnSite[]) {
  sites = next;
  renderSites();
  await save({ openOnSites: next });
}

function renderSites() {
  siteList.replaceChildren(
    ...sites.map((site, i) => {
      const name = el('input', { className: 'inline-name', value: site.name, title: 'Click to rename' });
      name.addEventListener('change', () => {
        const value = name.value.trim() || siteNameFromTemplate(site.template);
        void commitSites(sites.map((x) => (x.id === site.id ? { ...x, name: value } : x)));
      });
      const template = el('input', { className: 'inline-template', value: site.template, title: 'URL pattern' });
      template.addEventListener('change', () => {
        const problem = validateTemplate(template.value);
        showError(siteError, problem && `${site.name}: ${problem}`);
        if (problem) return void (template.value = site.template);
        void commitSites(sites.map((x) => (x.id === site.id ? { ...x, template: template.value.trim() } : x)));
      });
      const text = el('span');
      text.append(name, template);
      const li = el('li');
      li.append(
        text,
        actionButton('Test', 'Open with NSFS-484', () => {
          void chrome.tabs.create({ url: fillTemplate(site.template, SAMPLE) });
        }),
        actionButton('↑', 'Move up', () => commitSites(moveItem(sites, i, -1)), i === 0),
        actionButton('↓', 'Move down', () => commitSites(moveItem(sites, i, 1)), i === sites.length - 1),
        actionButton('Remove', 'Remove site', () => commitSites(sites.filter((x) => x.id !== site.id))),
      );
      return li;
    }),
  );
}

$('add-site').addEventListener('submit', (e) => {
  e.preventDefault();
  const template = siteTemplate.value.trim();
  const problem =
    validateTemplate(template) ?? (sites.some((x) => x.template === template) ? 'That site is already in the list.' : null);
  showError(siteError, problem);
  if (problem) return;
  const site = { id: newSiteId(), name: siteName.value.trim() || siteNameFromTemplate(template), template };
  void commitSites([...sites, site]);
  siteTemplate.value = '';
  siteName.value = '';
});

const loadSites = () =>
  getSettings().then((s) => {
    sites = s.openOnSites;
    renderSites();
  });
void loadSites();
chrome.storage.onChanged.addListener((changes) => {
  const editing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#sites');
  if (changes.openOnSites && !editing) void loadSites();
});

// --- Per-site lists: ▶ buttons/chip off, pop-up blocker ---
function siteListEditor(
  key: 'offSites' | 'popupBlockSites',
  prefix: string,
  text: { remove: string; removeTitle: (host: string) => string; already: (host: string) => string },
) {
  let sites: string[] = [];
  const render = () => {
    $(`${prefix}-empty`).hidden = sites.length > 0;
    $(`${prefix}-sites`).replaceChildren(
      ...sites.map((host) => {
        const li = el('li');
        li.append(
          el('span', { textContent: host }),
          actionButton(text.remove, text.removeTitle(host), () => {
            showError($<HTMLParagraphElement>(`${prefix}-error`), null);
            sites = sites.filter((s) => s !== host);
            render();
            void save({ [key]: sites });
          }),
        );
        return li;
      }),
    );
  };
  $(`add-${prefix}-site`).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>(`${prefix}-site`);
    const error = $<HTMLParagraphElement>(`${prefix}-error`);
    const host = siteKey(input.value);
    if (!host) return showError(error, 'Enter a site like javtiful.com.');
    if (sites.includes(host)) return showError(error, text.already(host));
    showError(error, null);
    sites = [...sites, host];
    render();
    void save({ [key]: sites });
    input.value = '';
  });
  const load = () =>
    getSettings().then((s) => {
      sites = s[key];
      render();
    });
  void load();
  chrome.storage.onChanged.addListener((changes) => changes[key] && void load());
}

siteListEditor('offSites', 'off', {
  remove: 'Turn back on',
  removeTitle: (host) => `Show ▶ buttons and chip on ${host} again`,
  already: (host) => `${host} is already turned off.`,
});
siteListEditor('popupBlockSites', 'popup', {
  remove: 'Allow pop-ups',
  removeTitle: (host) => `Stop blocking pop-ups on ${host}`,
  already: (host) => `Pop-ups are already blocked on ${host}.`,
});

// Show the shortcuts actually assigned (the user may have changed or cleared them).
async function showShortcuts() {
  const commands = await chrome.commands.getAll();
  for (const [name, id] of [
    ['open-trailer', 'key-open'],
    ['search-trailer', 'key-search'],
    ['open-on-all', 'key-all'],
  ]) {
    const shortcut = commands.find((c) => c.name === name)?.shortcut;
    document.getElementById(id)!.textContent = shortcut || 'Not set';
  }
}

// chrome:// links can't be opened from a plain <a> in extension pages.
document.getElementById('edit-shortcuts')!.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void init();
void showShortcuts();
