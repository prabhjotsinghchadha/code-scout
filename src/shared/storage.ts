// Typed wrapper around chrome.storage.sync.
import type { OpenMode } from './codes';

export interface Settings {
  /** Show a ▶ button next to codes found on pages. */
  inlineButtons: boolean;
  /** Open the video page directly (default) or the javtrailers search page. */
  openMode: OpenMode;
  /** Open trailer tabs in the background instead of switching to them. */
  openInBackground: boolean;
}

export const defaultSettings: Settings = {
  inlineButtons: true,
  openMode: 'video',
  openInBackground: false,
};

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
