import { formatCode, parseCode, type VideoCode } from '../shared/codes';
import { sendToBackground, sendToTab } from '../shared/messages';
import { getSettings, setSettings } from '../shared/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('search');
const input = $<HTMLInputElement>('code-input');
const error = $<HTMLParagraphElement>('error');
const list = $<HTMLUListElement>('codes');
const empty = $<HTMLParagraphElement>('empty');
const inline = $<HTMLInputElement>('inline');

async function open(code: VideoCode) {
  await sendToBackground({ type: 'OPEN_CODE', code });
  window.close();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = parseCode(input.value);
  error.hidden = !!code;
  if (!code) {
    error.textContent = 'That doesn’t look like a code (try e.g. NSFS-484).';
    return;
  }
  void open(code);
});

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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(formatCode(code), Object.assign(document.createElement('span'), { textContent: '▶' }));
    btn.addEventListener('click', () => void open(code));
    li.append(btn);
    list.append(li);
  }
}

async function init() {
  const settings = await getSettings();
  inline.checked = settings.inlineButtons;
  inline.addEventListener('change', () => setSettings({ inlineButtons: inline.checked }));

  $('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await loadPageCodes();
}

void init();
