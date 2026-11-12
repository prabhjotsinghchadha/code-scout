import type { OpenMode } from '../shared/codes';
import { siteKey } from '../shared/hosts';
import { dataFileName, exportData, importData, importSummary } from '../shared/data-file';
import { hydrateIcons, icon, type IconName } from '../shared/icons';
import { followLook } from '../shared/look';
import {
  newSiteId,
  PLACEHOLDERS,
  siteNameFromTemplate,
  validateTemplate,
  fillTemplate,
  type OpenOnSite,
} from '../shared/open-on';
import { moveItem } from '../shared/quick-links';
import { clearSeen } from '../shared/seen';
import { getSettings, setSettings, type Settings } from '../shared/storage';
import { aboutSite } from '../shared/sites';
import { subtitleLookVars } from '../shared/subtitles';
import { ACCENTS, applyTheme, isAccent, isTheme, onPageAccentVars, type Accent } from '../shared/theme';
import { createTranslators, translatorStatus } from '../shared/translator';
import { setupLinksEditor } from './links-editor';
import { setupProxy } from './proxy';

followLook();
hydrateIcons();

const status = document.getElementById('status') as HTMLDivElement;
const inlineButtons = document.getElementById('inlineButtons') as HTMLInputElement;
const fieldChip = document.getElementById('fieldChip') as HTMLInputElement;
const openInBackground = document.getElementById('openInBackground') as HTMLInputElement;
const rememberSeen = document.getElementById('rememberSeen') as HTMLInputElement;
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="openMode"]');

let timer: number | undefined;
/** A short note at the bottom of the page, like "Saved". */
function flash(text: string) {
  status.replaceChildren(icon('check', 14), text);
  status.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => status.classList.remove('show'), 1200);
}
async function save(patch: Partial<Settings>) {
  await setSettings(patch);
  flash('Saved');
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
  rememberSeen.checked = settings.rememberSeen;
  rememberSeen.addEventListener('change', () => save({ rememberSeen: rememberSeen.checked }));
  document.getElementById('clear-seen')!.addEventListener('click', async () => {
    await clearSeen();
    flash('Seen codes cleared');
  });
  modeRadios.forEach((r) =>
    r.addEventListener('change', () => r.checked && save({ openMode: r.value as OpenMode })),
  );
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

/** A square icon button; `title` is its tooltip and accessible name. */
function iconAction(name: IconName, title: string, onClick: () => void, disabled = false, className = '') {
  const b = el('button', { type: 'button', className: `icon-btn ${className}`.trim(), title, disabled });
  b.setAttribute('aria-label', title);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

function textAction(label: string, title: string, onClick: () => void) {
  const b = el('button', { type: 'button', className: 'btn ghost sm', textContent: label, title });
  b.addEventListener('click', onClick);
  return b;
}

function showError(target: HTMLParagraphElement, message: string | null) {
  target.hidden = !message;
  target.textContent = message ?? '';
}

// --- Quick links & groups (links-editor.ts) ---
void setupLinksEditor(save, flash);

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
        iconAction('external', 'Test: open with NSFS-484', () => {
          void chrome.tabs.create({ url: fillTemplate(site.template, SAMPLE) });
        }),
        iconAction('arrowUp', 'Move up', () => commitSites(moveItem(sites, i, -1)), i === 0),
        iconAction('arrowDown', 'Move down', () => commitSites(moveItem(sites, i, 1)), i === sites.length - 1),
        iconAction('trash', 'Remove site', () => commitSites(sites.filter((x) => x.id !== site.id)), false, 'danger'),
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

// --- Per-site lists: ▶ buttons/chip off, pop-up blocker, video tools ---
function siteListEditor(
  key: 'offSites' | 'popupBlockSites' | 'videoOffSites',
  prefix: string,
  text: { remove: string; removeTitle: (host: string) => string; already: (host: string) => string },
) {
  let sites: string[] = [];
  const render = () => {
    $(`${prefix}-empty`).hidden = sites.length > 0;
    // Where the list is folded away, its heading says how many it holds.
    const count = document.getElementById(`${prefix}-count`);
    if (count) count.textContent = sites.length ? String(sites.length) : '';
    $(`${prefix}-sites`).replaceChildren(
      ...sites.map((host) => {
        const li = el('li');
        li.append(
          el('span', { textContent: host }),
          textAction(text.remove, text.removeTitle(host), () => {
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
// Video tools: on everywhere unless switched off here, or per site below.
async function setupVideoToolsSwitch() {
  const box = $<HTMLInputElement>('videoTools');
  const settings = await getSettings();
  box.checked = settings.videoTools;
  box.addEventListener('change', () => save({ videoTools: box.checked }));
  const keys = $<HTMLInputElement>('playerKeys');
  keys.checked = settings.playerKeys;
  keys.addEventListener('change', () => save({ playerKeys: keys.checked }));
  const messages = $<HTMLInputElement>('toolbarMessages');
  messages.checked = settings.toolbarMessages;
  messages.addEventListener('change', () => save({ toolbarMessages: messages.checked }));
}
void setupVideoToolsSwitch();
siteListEditor('videoOffSites', 'video', {
  remove: 'Turn back on',
  removeTitle: (host) => `Turn video tools back on for ${host}`,
  already: (host) => `Video tools are already off on ${host}.`,
});

// English subtitles: Chrome downloads its Chinese/Japanese → English models once, which needs a click.
// EN subs on a video can do it too; this is for when the page itself can't (the status says so).
async function showTranslationStatus() {
  const button = document.getElementById('setup-translation') as HTMLButtonElement;
  const label = document.getElementById('translation-status')!;
  const status = await translatorStatus();
  if (!status) {
    button.hidden = true;
    label.textContent = 'English subtitles need Chrome 138 or newer (on-device translation).';
    return;
  }
  const ready = status.zh === 'available' && status.ja === 'available';
  button.hidden = ready;
  label.textContent = ready
    ? '✓ English subtitles are set up (Chinese and Japanese, translated on this computer).'
    : 'One-time download of Chrome’s Chinese and Japanese translators.';
}
document.getElementById('setup-translation')!.addEventListener('click', () => {
  const label = document.getElementById('translation-status')!;
  label.textContent = 'Setting up…';
  createTranslators((text) => (label.textContent = text)).then(
    () => void showTranslationStatus(),
    (err: unknown) => (label.textContent = err instanceof Error ? err.message : String(err)),
  );
});
void showTranslationStatus();

/** English subtitles: text size and background, previewed live and saved when the slider is let go. */
async function setupSubtitleLook() {
  const settings = await getSettings();
  const size = $<HTMLInputElement>('subSize');
  const background = $<HTMLInputElement>('subBackground');
  const preview = $('sub-preview');
  const paint = () => {
    const bg = Number(background.value);
    $('subSize-value').textContent = `${size.value}%`;
    $('subBackground-value').textContent =
      bg >= 100 ? 'Solid: hides the original line' : bg <= 0 ? 'None: text only, with an outline' : `${bg}%: the original shows through`;
    preview.style.fontSize = `${(18 * Number(size.value)) / 100}px`;
    for (const [name, value] of Object.entries(subtitleLookVars(bg))) preview.style.setProperty(name, value);
  };
  size.value = String(settings.subSize);
  background.value = String(settings.subBackground);
  paint();
  size.addEventListener('input', paint);
  background.addEventListener('input', paint);
  size.addEventListener('change', () => save({ subSize: Number(size.value) }));
  background.addEventListener('change', () => save({ subBackground: Number(background.value) }));
}
void setupSubtitleLook();

// Show the shortcuts actually assigned (the user may have changed or cleared them).
async function showShortcuts() {
  const commands = await chrome.commands.getAll();
  for (const [name, id] of [
    ['open-trailer', 'key-open'],
    ['search-trailer', 'key-search'],
    ['open-on-all', 'key-all'],
    ['hide-watching', 'key-hide'],
    ['close-watching', 'key-close'],
  ]) {
    const shortcut = commands.find((c) => c.name === name)?.shortcut;
    document.getElementById(id)!.textContent = shortcut || 'Not set';
  }
}

// chrome:// links can't be opened from a plain <a> in extension pages.
document.getElementById('edit-shortcuts')!.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// --- Backup: everything in one file (shared/data-file.ts) ---
/** The import's summary, kept over the reload that shows the imported settings. */
const IMPORTED_KEY = 'importedSummary';

function setupBackup() {
  const status = $<HTMLParagraphElement>('backup-status');
  const error = $<HTMLParagraphElement>('backup-error');
  const picker = $<HTMLInputElement>('import-file');
  const say = (text: string) => {
    showError(error, null);
    status.hidden = false;
    status.textContent = text;
  };

  $('export-data').addEventListener('click', async () => {
    try {
      const now = Date.now();
      const url = URL.createObjectURL(new Blob([JSON.stringify(await exportData(now), null, 2)], { type: 'application/json' }));
      el('a', { href: url, download: dataFileName(now) }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      say(`Saved ${dataFileName(now)} to your downloads.`);
    } catch (err) {
      console.error('Export failed', err);
      showError(error, 'Couldn’t make the backup file.');
    }
  });

  $('import-data').addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = ''; // so picking the same file again asks again
    if (!file) return;
    const sure = confirm(
      `Import ${file.name}?\n\nThe settings, quick links and sites here are replaced with the file’s. Favourites, seen codes and subtitle choices are added to what’s here.`,
    );
    if (!sure) return;
    status.hidden = true;
    try {
      const summary = importSummary(await importData(await file.text()));
      // Every section reads its settings when the page loads: load it again, then say what was imported.
      sessionStorage.setItem(IMPORTED_KEY, summary);
      location.hash = 'backup';
      location.reload();
    } catch (err) {
      showError(error, err instanceof Error ? err.message : 'Couldn’t import that file.');
    }
  });

  const imported = sessionStorage.getItem(IMPORTED_KEY);
  if (imported) {
    sessionStorage.removeItem(IMPORTED_KEY);
    say(imported);
  }
}
setupBackup();

/**
 * One section on show at a time: the one in the address (#video), picked in the side nav. Text in the
 * search box shows instead every section that mentions it, one under the other.
 */
function setupSections() {
  const links = new Map([...document.querySelectorAll<HTMLAnchorElement>('.side nav a')].map((a) => [a.hash.slice(1), a]));
  const sections = [...links.keys()].flatMap((id) => document.getElementById(id) ?? []);
  const search = $<HTMLInputElement>('settings-search');
  const noMatch = $<HTMLParagraphElement>('no-match');
  /** Lower case, without spaces and dashes, so "popup" finds "Pop-up blocker". */
  const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

  const show = () => {
    const query = squash(search.value);
    const current = links.has(location.hash.slice(1)) ? location.hash.slice(1) : sections[0]?.id;
    let shown = 0;
    for (const section of sections) {
      // textContent: sections that aren't on show have no innerText.
      const on = query ? squash(section.textContent ?? '').includes(query) : section.id === current;
      section.hidden = !on;
      if (on) shown++;
      // What was looked for may be in a folded part: unfold it.
      if (on && query) {
        section.querySelectorAll<HTMLDetailsElement>('details.more').forEach((d) => {
          if (squash(d.textContent ?? '').includes(query)) d.open = true;
        });
      }
    }
    for (const [id, a] of links) a.setAttribute('aria-current', String(!query && id === current));
    document.body.classList.toggle('searching', !!query);
    noMatch.hidden = shown > 0;
    noMatch.textContent = `No setting mentions “${search.value.trim()}”.`;
  };

  search.addEventListener('input', show);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      show();
    }
  });
  // Picking a section leaves the search.
  for (const a of links.values()) {
    a.addEventListener('click', () => {
      search.value = '';
      show(); // the address may not change (the section picked is the one in it)
    });
  }
  window.addEventListener('hashchange', () => {
    show();
    window.scrollTo(0, 0);
  });
  show();
  // Opened at a section (#video): the browser scrolls to where it was in the whole page. Back to the top.
  history.scrollRestoration = 'manual';
  window.addEventListener('load', () => window.scrollTo(0, 0));
}

/** Appearance: theme and accent. A change shows at once (here, and in an open popup) and is saved. */
async function setupAppearance() {
  const settings = await getSettings();
  let look = { theme: settings.theme, accent: settings.accent };
  const preview = $<HTMLDivElement>('look-preview');
  const paint = () => {
    applyTheme(look);
    // The marks in the preview are the on-page ones: their colours come from the page variables.
    for (const [name, value] of Object.entries(onPageAccentVars(look.accent))) preview.style.setProperty(name, value);
  };

  const themes = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');
  themes.forEach((r) => {
    r.checked = r.value === look.theme;
    r.addEventListener('change', () => {
      if (!r.checked || !isTheme(r.value)) return;
      look = { ...look, theme: r.value };
      paint();
      void save({ theme: r.value });
    });
  });

  // Lists in the popup: what each code is under it, or codes only.
  document.querySelectorAll<HTMLInputElement>('input[name="listStyle"]').forEach((r) => {
    r.checked = r.value === settings.listStyle;
    r.addEventListener('change', () => {
      if (r.checked && (r.value === 'detailed' || r.value === 'compact')) void save({ listStyle: r.value });
    });
  });

  // The Guide's list of where a code can be watched: the user's own sites, each with what it's for.
  $<HTMLUListElement>('guide-sites').replaceChildren(
    ...settings.openOnSites.map((site) => {
      const li = document.createElement('li');
      const name = Object.assign(document.createElement('strong'), { textContent: site.name });
      li.append(name, ` ${aboutSite(site.id) ?? 'A site you added.'}`);
      return li;
    }),
  );

  const swatches = $<HTMLDivElement>('accents');
  swatches.replaceChildren(
    ...(Object.keys(ACCENTS) as Accent[]).map((name) => {
      const label = document.createElement('label');
      label.className = 'swatch';
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'accent', value: name, checked: name === look.accent });
      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      dot.style.setProperty('--swatch', ACCENTS[name].swatch);
      dot.append(icon('check', 14));
      label.append(radio, dot, ACCENTS[name].label);
      radio.addEventListener('change', () => {
        if (!radio.checked || !isAccent(radio.value)) return;
        look = { ...look, accent: radio.value };
        paint();
        void save({ accent: radio.value });
      });
      return label;
    }),
  );
  paint();
}

void init();
void setupAppearance();
void showShortcuts();
void setupProxy(flash);
setupSections();
