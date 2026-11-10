// Typed wrapper around chrome.storage.sync.
import type { OpenMode } from './codes';
import type { OpenOnSite } from './open-on.ts';
import type { QuickLink } from './quick-links.ts';
import { DEFAULT_ACCENT, DEFAULT_THEME, type Accent, type Theme } from './theme.ts';
import { BUILT_INS, LEGACY_KEYS, offeredByVersion, seed, type BuiltIns } from './seed.ts';

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
  /** Other sites a code can be opened on ("Open on"), in display order. */
  openOnSites: OpenOnSite[];
  /** Sites (hostnames, see hosts.ts) where the ▶ buttons and chip are turned off. */
  offSites: string[];
  /** Sites where pop-ups, ad tabs and script redirects to other sites are blocked. */
  popupBlockSites: string[];
  /** Video tools on every site's videos: toolbar, faster loading, quality, download, English subtitles. */
  videoTools: boolean;
  /** Sites where video tools are turned off. */
  videoOffSites: string[];
  /**
   * Keys for the video being watched: space/K play and pause, arrows and J/L seek, , and . step a frame,
   * < and > change the speed, M mutes, P is picture-in-picture. Where video tools are on.
   */
  playerKeys: boolean;
  /** The video toolbar's messages under it ("Quality: 720p", "Saved …", errors, a key's "+5s"). Off unless switched on. */
  toolbarMessages: boolean;
  /** English subtitles: text size, % of the usual (which follows the video's height). */
  subSize: number;
  /** English subtitles: how opaque the box behind them is, %. 100 hides the original line; 0 is text only. */
  subBackground: number;
  /** Count visits to quick-link sites (on this computer) and show the most visited in the popup. */
  mostVisited: boolean;
  /**
   * Remember the codes opened or whose video pages were visited (on this computer, not in incognito): ✓ on
   * their ▶ buttons and the popup's Recent tab. See seen.ts.
   */
  rememberSeen: boolean;
  /** Appearance: light, dark, or whichever the system is in. */
  theme: Theme;
  /** Appearance: the accent colour, in the popup and Settings and for what's drawn on pages (theme.ts). */
  accent: Accent;
  /**
   * The popup's lists: "detailed" says what each code is under it (title, performers, studio) once that's
   * known; "compact" is codes only, more to a screen. Density only: nothing is out of reach in either.
   */
  listStyle: 'detailed' | 'compact';
  /** The popup's one-time "New here?" card was closed (or this install is older than the card). */
  introSeen: boolean;
}

export const defaultSettings: Settings = {
  inlineButtons: true,
  fieldChip: true,
  openMode: 'video',
  openInBackground: false,
  quickLinks: [],
  linkGroups: [],
  openOnSites: [],
  offSites: [],
  popupBlockSites: [],
  videoTools: true,
  videoOffSites: [],
  playerKeys: true,
  toolbarMessages: false,
  subSize: 100,
  subBackground: 100,
  mostVisited: true,
  rememberSeen: true,
  theme: DEFAULT_THEME,
  accent: DEFAULT_ACCENT,
  listStyle: 'detailed',
  introSeen: false,
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
  chrome.storage.onChanged.addListener((changes, area) => {
    // Other synced keys (the built-ins record, favourites) aren't settings.
    if (area === 'sync' && Object.keys(changes).some((k) => k in defaultSettings)) void getSettings().then(callback);
  });
}

/** The settings built-ins are added to. */
const SEEDED_KEYS = ['quickLinks', 'linkGroups', 'openOnSites'] as const;

/**
 * Offer the built-in sites, pages and groups (sites.ts) this user hasn't been offered yet. Each is
 * offered once, so anything the user removes or renames later isn't brought back.
 *
 * The record of what was offered ("seededBuiltIns") is kept in sync storage, shared by the user's
 * devices, with a copy in local storage. Sync is only written when something changed, so installing
 * on another device never overwrites the data synced from the first one.
 */
export async function seedBuiltIns(builtIns: BuiltIns = BUILT_INS): Promise<void> {
  // Read without defaults: whether the lists exist in sync at all matters below.
  const stored = await chrome.storage.sync.get<
    Partial<Pick<Settings, (typeof SEEDED_KEYS)[number]>> & { seededBuiltIns?: string[] }
  >([...SEEDED_KEYS, 'seededBuiltIns']);
  const local = await chrome.storage.local.get<{ seededBuiltIns: string[]; quickLinksSeedVersion: number }>({
    seededBuiltIns: [],
    quickLinksSeedVersion: 0, // set by installs from before keys; see offeredByVersion
  });
  const synced = stored.seededBuiltIns ?? [];
  // Lists in sync but no record anywhere: they were seeded on another device by a build from before the
  // record was synced. Count everything such a build could have offered as offered.
  const fromOlderBuild =
    !stored.seededBuiltIns &&
    !local.seededBuiltIns.length &&
    !local.quickLinksSeedVersion &&
    SEEDED_KEYS.some((k) => k in stored);
  const offered = [
    ...synced,
    ...local.seededBuiltIns,
    ...offeredByVersion(local.quickLinksSeedVersion),
    ...(fromOlderBuild ? LEGACY_KEYS : []),
  ];
  const state = {
    quickLinks: stored.quickLinks ?? [],
    linkGroups: stored.linkGroups ?? [],
    openOnSites: stored.openOnSites ?? [],
  };
  // Never offered anything: a new install, which gets the starting points for new users (seed.ts).
  const result = seed(state, offered, builtIns, offered.length === 0);
  const record = result?.offered ?? [...new Set(offered)];
  // Only the lists that changed: a built-in that isn't for this install adds its key to the record and
  // nothing else, and lists that are the same aren't written back over what another device may have synced.
  const changed = Object.fromEntries(
    SEEDED_KEYS.filter((k) => result && JSON.stringify(result.state[k]) !== JSON.stringify(state[k])).map((k) => [k, result!.state[k]]),
  );

  // One write, so the lists and the record land together or not at all. Sync before local: a failed
  // sync write must not mark anything as offered on this device.
  const patch = { ...changed, ...(record.some((k) => !synced.includes(k)) && { seededBuiltIns: record }) };
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  if (record.some((k) => !local.seededBuiltIns.includes(k))) await chrome.storage.local.set({ seededBuiltIns: record });
}
