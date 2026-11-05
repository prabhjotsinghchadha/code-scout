// Typed wrapper around chrome.storage.sync.
export interface Settings {
  enabled: boolean;
}

export const defaultSettings: Settings = {
  enabled: true,
};

export async function getSettings(): Promise<Settings> {
  // Passing defaults returns stored values merged over them.
  return chrome.storage.sync.get<Settings>(defaultSettings);
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
