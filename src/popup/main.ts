import { sendToBackground, sendToTab } from '../shared/messages';
import { getSettings, setSettings } from '../shared/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const enabledEl = $<HTMLInputElement>('enabled');
const output = $<HTMLPreElement>('output');

function show(value: unknown) {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function init() {
  const settings = await getSettings();
  enabledEl.checked = settings.enabled;

  enabledEl.addEventListener('change', () => setSettings({ enabled: enabledEl.checked }));

  $('ping').addEventListener('click', async () => {
    show(await sendToBackground({ type: 'PING' }));
  });

  $('page-info').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return show('No active tab');
    try {
      show(await sendToTab(tab.id, { type: 'GET_PAGE_INFO' }));
    } catch {
      show('Content script not available on this page (try reloading it).');
    }
  });

  $('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

void init();
