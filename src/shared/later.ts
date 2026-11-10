// Watch later: codes put aside to come back to, apart from the favourites (which are the ones liked).
// Kept like the seen codes are, and with their helpers (seen.ts): "NSFS-484" → when it was added and the
// page it was on, in chrome.storage.local, on this computer (sync's keys are the favourites'). In the
// backup file too.
import { formatCode, type VideoCode } from './codes.ts';
import { addSeen, forgetSeen, type Seen, type SeenPage } from './seen.ts';

/** "NSFS-484" → when it was put aside (`at`) and the page it was on. */
export type Later = Seen;

export const LATER_KEY = 'watchLater';
/** The most kept; past this, the ones added longest ago go. */
export const MAX_LATER = 500;

export const isLater = (later: Later, code: VideoCode): boolean => formatCode(code) in later;

export async function getLater(): Promise<Later> {
  const stored = await chrome.storage.local.get<{ [LATER_KEY]: Later }>({ [LATER_KEY]: {} });
  return stored[LATER_KEY];
}

export function onLaterChanged(callback: (later: Later) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LATER_KEY]) callback((changes[LATER_KEY].newValue as Later | undefined) ?? {});
  });
}

let writing = Promise.resolve();
function update(change: (later: Later) => Later): Promise<void> {
  writing = writing
    .then(async () => {
      await chrome.storage.local.set({ [LATER_KEY]: change(await getLater()) });
    })
    .catch((err) => console.warn('Updating Watch later failed', err));
  return writing;
}

/** Puts `code` aside (with the page it was on, if any), or takes it back off the list. */
export function setLater(code: VideoCode, on: boolean, page?: SeenPage | null): Promise<void> {
  return update((later) => (on ? addSeen(later, code, Date.now(), page, MAX_LATER) : forgetSeen(later, code)));
}
