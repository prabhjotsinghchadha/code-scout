// Typed wrapper around chrome.storage.sync.
import type { OpenMode } from './codes';
import { hasGroup, type QuickLink } from './quick-links.ts';

export type { QuickLink } from './quick-links';

export interface Settings {
  /** Show a ▶ button next to codes found on pages. */
  inlineButtons: boolean;
  /** Show an Open/Search chip when a code is typed into a text field. */
  fieldChip: boolean;
  /** Open the video page directly (default) or the javtrailers search page. */
  openMode: OpenMode;
  /** Open trailer tabs in the background instead of switching to them. */
  openInBackground: boolean;
  /** Sites/pages the user wants one click away in the popup. */
  quickLinks: QuickLink[];
  /** Quick-link group names in display order (e.g. "Cheating", "Cuckold", "NTR"). */
  linkGroups: string[];
}

/**
 * Built-in quick links and groups, added once on install/update (see seedQuickLinks).
 * `since` is the seed version that introduced each link, so updates only add new ones.
 */
export const BUILT_IN_QUICK_LINKS: (QuickLink & { since: number })[] = [
  { since: 1, name: 'MissAV · English subtitle', url: 'https://missav.ws/dm23/en/english-subtitle' },
  { since: 1, name: 'JavMost · Cuckold', url: 'https://www.javmost.ws/category/Cuckold/', group: 'Cuckold' },
  {
    since: 1,
    name: 'Javtiful · Affair (popular)',
    url: 'https://javtiful.com/category/affair?sort=popular',
    group: 'Cheating',
  },
  { since: 3, name: 'JavLibrary · Most wanted', url: 'https://www.javlibrary.com/en/vl_mostwanted.php' },
  { since: 3, name: 'JavTrailers · Cheating Wife', url: 'https://javtrailers.com/categories/cheating-wife', group: 'Cheating' },
  { since: 3, name: 'JavTrailers · Adultery', url: 'https://javtrailers.com/categories/adultery', group: 'Cheating' },
];
export const BUILT_IN_GROUPS = ['Cheating', 'Cuckold', 'NTR'];
/**
 * Bump when changing the built-ins above so existing installs receive them.
 * 1: first links. 2: built-in groups (+ grouping existing built-in links). 3: JavLibrary + javtrailers categories.
 */
const QUICK_LINKS_SEED_VERSION = 3;

export const defaultSettings: Settings = {
  inlineButtons: true,
  fieldChip: true,
  openMode: 'video',
  openInBackground: false,
  quickLinks: [],
  linkGroups: [],
};

/** Accepts "example.com/path" or a full URL; returns a normalized http(s) URL or null. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A readable default name: "javtrailers.com › search" style, from the host and last path part. */
export function defaultLinkName(url: string): string {
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./, '');
  const last = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
  return last ? `${host} › ${last}` : host;
}

export async function getSettings(): Promise<Settings> {
  // Passing defaults returns stored values merged over them.
  return chrome.storage.sync.get<Settings>(defaultSettings);
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void getSettings().then(callback);
  });
}

/**
 * Add built-in quick links and groups the user doesn't have yet. Each step runs once,
 * so anything the user removes or renames later isn't brought back.
 */
export async function seedQuickLinks(): Promise<void> {
  const { quickLinksSeedVersion: version = 0 } = await chrome.storage.local.get<{ quickLinksSeedVersion?: number }>(
    'quickLinksSeedVersion',
  );
  if (version >= QUICK_LINKS_SEED_VERSION) return;
  let { quickLinks, linkGroups } = await getSettings();

  if (version < 2) {
    linkGroups = [...linkGroups, ...BUILT_IN_GROUPS.filter((g) => !hasGroup(linkGroups, g))];
    // Put built-in links the user already has (and hasn't grouped) into their group.
    quickLinks = quickLinks.map((l) => {
      const group = !l.group && BUILT_IN_QUICK_LINKS.find((b) => b.url === l.url)?.group;
      return group ? { ...l, group } : l;
    });
  }
  const added = BUILT_IN_QUICK_LINKS.filter((b) => b.since > version && !quickLinks.some((l) => l.url === b.url));
  quickLinks = [...quickLinks, ...added.map(({ since: _since, ...link }) => link)];

  await setSettings({ quickLinks, linkGroups });
  await chrome.storage.local.set({ quickLinksSeedVersion: QUICK_LINKS_SEED_VERSION });
}
