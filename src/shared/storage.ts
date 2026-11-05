// Typed wrapper around chrome.storage.sync.
import type { OpenMode } from './codes';

export interface QuickLink {
  name: string;
  url: string;
}

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
}

export const defaultSettings: Settings = {
  inlineButtons: true,
  fieldChip: true,
  openMode: 'video',
  openInBackground: false,
  quickLinks: [],
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
