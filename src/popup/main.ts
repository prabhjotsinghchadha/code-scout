import { formatCode, parseCode, type OpenMode, type VideoCode } from '../shared/codes';
import { siteKey } from '../shared/hosts';
import { sendToBackground, sendToTab } from '../shared/messages';
import { fillTemplate, type OpenOnSite } from '../shared/open-on';
import { addGroup, groupLinks, validateGroupName, type LinkState, type QuickLink } from '../shared/quick-links';
import { defaultLinkName, getSettings, normalizeUrl, setSettings } from '../shared/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('search');
const input = $<HTMLInputElement>('code-input');
const error = $<HTMLParagraphElement>('error');
const list = $<HTMLUListElement>('codes');
const empty = $<HTMLParagraphElement>('empty');
const inline = $<HTMLInputElement>('inline');
const chip = $<HTMLInputElement>('chip');

/** `mode` undefined = the "Open" setting (video page by default). */
async function open(code: VideoCode, mode?: OpenMode) {
  await sendToBackground({ type: 'OPEN_CODE', code, mode });
  window.close();
}

function openTyped(mode?: OpenMode) {
  const code = parseCode(input.value);
  error.hidden = !!code;
  if (!code) {
    error.textContent = 'That doesn’t look like a code (try e.g. NSFS-484).';
    return;
  }
  void open(code, mode);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  openTyped();
});
$('search-btn').addEventListener('click', () => openTyped('search'));

function smallButton(text: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

async function loadPageCodes() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let codes: VideoCode[] = [];
  try {
    if (tab?.id !== undefined) codes = (await sendToTab(tab.id, { type: 'GET_PAGE_CODES' })).codes;
  } catch {
    // No content script here (chrome:// pages, Web Store, or a tab opened before install).
  }
  empty.hidden = codes.length > 0;
  for (const code of codes) {
    const li = document.createElement('li');
    const label = Object.assign(document.createElement('span'), { className: 'code', textContent: formatCode(code) });
    li.append(
      label,
      smallButton('▶ Open', '', () => void open(code)),
      smallButton('Search', 'secondary', () => void open(code, 'search')),
    );
    let sitesRow: HTMLLIElement | null = null;
    if (sites.length) {
      li.append(
        smallButton('Sites', 'secondary', () => {
          if (sitesRow) {
            sitesRow.remove();
            sitesRow = null;
            return;
          }
          sitesRow = Object.assign(document.createElement('li'), { className: 'sites' });
          sitesRow.append(siteRow(() => code));
          li.after(sitesRow);
        }),
      );
    }
    list.append(li);
  }
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
  for (const site of sites) row.append(smallButton(site.name, '', () => go([site])));
  if (sites.length > 1) row.append(smallButton(`All ${sites.length}`, 'all', () => go(sites)));
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

async function openLinks(urls: string[]) {
  const { openInBackground } = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const [i, url] of urls.entries()) {
    // With several links, only the first one takes focus (unless background tabs are on).
    await chrome.tabs.create({
      url,
      active: !openInBackground && i === 0,
      ...(tab && { index: tab.index + 1 + i, openerTabId: tab.id }),
    });
  }
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
  const a = Object.assign(document.createElement('a'), { href: url, textContent: name, title: url });
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
    summary.append(
      group,
      Object.assign(document.createElement('span'), { className: 'count', textContent: `${links.length}` }),
    );
    if (links.length > 1) {
      const all = smallButton('Open all', 'link-button open-all', () => {
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
async function setupAddPage(state: LinkState) {
  const btn = $<HTMLButtonElement>('add-page');
  const form = $<HTMLFormElement>('add-page-form');
  const select = $<HTMLSelectElement>('add-page-group');
  const newGroup = $<HTMLInputElement>('add-page-new-group');
  const addError = $<HTMLParagraphElement>('add-page-error');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url && /^https?:/.test(tab.url) ? normalizeUrl(tab.url) : null;
  if (!url) {
    btn.hidden = true;
    return;
  }
  const mark = (added: boolean) => {
    btn.disabled = added;
    btn.textContent = added ? '✓ Added' : '+ Add this page';
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

/** "Off on javtiful.com": turn the ▶ buttons and chip off for the current site. */
async function setupSiteOff(offSites: string[]) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url && /^https?:/.test(tab.url) ? siteKey(tab.url) : null;
  if (!host) return;
  const box = $<HTMLInputElement>('site-off');
  $('site-off-host').textContent = host;
  $('site-off-row').hidden = false;
  box.checked = offSites.includes(host);
  box.addEventListener('change', async () => {
    const current = (await getSettings()).offSites.filter((s) => s !== host);
    await setSettings({ offSites: box.checked ? [...current, host] : current });
  });
}

async function init() {
  const settings = await getSettings();
  sites = settings.openOnSites;
  setupTypedSites();
  inline.checked = settings.inlineButtons;
  chip.checked = settings.fieldChip;
  inline.addEventListener('change', () => setSettings({ inlineButtons: inline.checked }));
  chip.addEventListener('change', () => setSettings({ fieldChip: chip.checked }));
  await setupSiteOff(settings.offSites);

  const linkState: LinkState = { quickLinks: settings.quickLinks, linkGroups: settings.linkGroups };
  renderLinks(linkState);
  await setupAddPage(linkState);

  for (const id of ['open-options', 'add-links']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  await loadPageCodes();
}

void init();
