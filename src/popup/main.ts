import { formatCode, parseCode, type OpenMode, type VideoCode } from '../shared/codes';
import { sendToBackground, sendToTab } from '../shared/messages';
import { defaultLinkName, getSettings, normalizeUrl, setSettings, type QuickLink } from '../shared/storage';

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
    list.append(li);
  }
}

async function openLink(url: string) {
  const { openInBackground } = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.create({ url, active: !openInBackground, ...(tab && { index: tab.index + 1, openerTabId: tab.id }) });
  window.close();
}

function renderLinks(links: QuickLink[]) {
  const container = $('links');
  container.replaceChildren();
  $('links-empty').hidden = links.length > 0;
  for (const { name, url } of links) {
    const a = Object.assign(document.createElement('a'), { href: url, textContent: name, title: url });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void openLink(url);
    });
    container.append(a);
  }
}

/** "+ Add this page": activeTab gives us the current tab's URL/title while the popup is open. */
async function setupAddPage(links: QuickLink[]) {
  const btn = $<HTMLButtonElement>('add-page');
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
  mark(links.some((l) => l.url === url));
  btn.addEventListener('click', async () => {
    const name = tab.title?.trim().slice(0, 60) || defaultLinkName(url);
    const next = [...(await getSettings()).quickLinks, { name, url }];
    await setSettings({ quickLinks: next });
    renderLinks(next);
    mark(true);
  });
}

async function init() {
  const settings = await getSettings();
  inline.checked = settings.inlineButtons;
  chip.checked = settings.fieldChip;
  inline.addEventListener('change', () => setSettings({ inlineButtons: inline.checked }));
  chip.addEventListener('change', () => setSettings({ fieldChip: chip.checked }));

  renderLinks(settings.quickLinks);
  await setupAddPage(settings.quickLinks);

  for (const id of ['open-options', 'add-links']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  await loadPageCodes();
}

void init();
