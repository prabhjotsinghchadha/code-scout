import type { OpenMode } from '../shared/codes';
import {
  defaultLinkName,
  getSettings,
  normalizeUrl,
  setSettings,
  type QuickLink,
  type Settings,
} from '../shared/storage';

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

// --- Quick links ---
const linkList = document.getElementById('links') as HTMLUListElement;
const linkUrl = document.getElementById('link-url') as HTMLInputElement;
const linkName = document.getElementById('link-name') as HTMLInputElement;
const linkError = document.getElementById('link-error') as HTMLParagraphElement;
let links: QuickLink[] = [];

function renderLinks() {
  linkList.replaceChildren(
    ...links.map((link, i) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.append(Object.assign(document.createElement('strong'), { textContent: link.name }));
      text.append(Object.assign(document.createElement('small'), { textContent: link.url }));
      const actions = [
        ['↑', 'Move up', () => move(i, -1), i === 0],
        ['↓', 'Move down', () => move(i, 1), i === links.length - 1],
        ['Remove', 'Remove', () => saveLinks(links.filter((_, j) => j !== i)), false],
      ] as const;
      li.append(text);
      for (const [label, title, onClick, disabled] of actions) {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title, disabled });
        b.addEventListener('click', onClick);
        li.append(b);
      }
      return li;
    }),
  );
}

function move(i: number, delta: number) {
  const next = [...links];
  [next[i], next[i + delta]] = [next[i + delta], next[i]];
  void saveLinks(next);
}

async function saveLinks(next: QuickLink[]) {
  links = next;
  renderLinks();
  await save({ quickLinks: links });
}

function addLink(rawUrl: string, rawName: string) {
  const url = normalizeUrl(rawUrl);
  linkError.hidden = !!url;
  if (!url) {
    linkError.textContent = 'Enter a valid web address (http or https).';
    return false;
  }
  if (links.some((l) => l.url === url)) {
    linkError.hidden = false;
    linkError.textContent = 'That link is already in the list.';
    return false;
  }
  void saveLinks([...links, { name: rawName.trim() || defaultLinkName(url), url }]);
  return true;
}

document.getElementById('add-link')!.addEventListener('submit', (e) => {
  e.preventDefault();
  if (addLink(linkUrl.value, linkName.value)) {
    linkUrl.value = '';
    linkName.value = '';
  }
});

const loadLinks = () =>
  getSettings().then((s) => {
    links = s.quickLinks;
    renderLinks();
  });
void loadLinks();
chrome.storage.onChanged.addListener((changes) => changes.quickLinks && void loadLinks());

// Show the shortcuts actually assigned (the user may have changed or cleared them).
async function showShortcuts() {
  const commands = await chrome.commands.getAll();
  for (const [name, id] of [['open-trailer', 'key-open'], ['search-trailer', 'key-search']]) {
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
