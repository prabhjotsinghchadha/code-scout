// "Close what I'm watching" (a shortcut) and "Clear watch history" (the popup's bin button): the tabs on
// the user's video sites are closed, and for the second, those sites' pages are also removed from the
// browser's history. Which tabs and pages: shared/wipe.ts. The extension's own lists (favourites, seen
// codes) are left as they are.
//
// Safari on iPhone has no shortcuts and no history API: there the button is the way to close the tabs,
// and that is all it does.
import { getSeen } from '../shared/seen';
import { getSettings } from '../shared/storage';
import { isWatchUrl, wipeSites } from '../shared/wipe';
import { HIDDEN_KEY } from './hide';

async function sites(): Promise<string[]> {
  const [settings, seen] = await Promise.all([getSettings(), getSeen()]);
  return wipeSites(settings, seen);
}

/** Closes every tab on the user's sites, hidden ones too. Returns how many. */
async function closeTabs(watched: string[]): Promise<number> {
  const tabs = await chrome.tabs.query({});
  const closing = tabs.filter((t) => t.id !== undefined && (isWatchUrl(t.url, watched) || isWatchUrl(t.pendingUrl, watched)));
  if (!closing.length) return 0;
  const ids = new Set(closing.map((t) => t.id!));

  // The minimised windows of "Hide what I'm watching" go with their tabs.
  // (No hiding, and maybe no session storage, in Safari on iPhone: nothing to look for there.)
  const stored: Record<string, unknown> = (await chrome.storage.session?.get(HIDDEN_KEY).catch(() => null)) ?? {};
  const hidden = stored[HIDDEN_KEY] as { stashes: { windowId: number; blankTabId?: number }[] } | undefined;
  const stashes = new Map((hidden?.stashes ?? []).map((s) => [s.windowId, s.blankTabId]));

  // A window about to lose all its tabs would close (and the browser with the last one): it gets a new
  // tab first.
  for (const windowId of new Set(closing.map((t) => t.windowId))) {
    if (stashes.has(windowId)) continue;
    if (tabs.some((t) => t.windowId === windowId && !ids.has(t.id!))) continue;
    await chrome.tabs.create({ windowId, active: true }).catch(() => {});
  }
  await chrome.tabs.remove([...ids]).catch(() => {});

  let left = 0;
  for (const [windowId, blankTabId] of stashes) {
    const rest = await chrome.tabs.query({ windowId }).catch(() => []);
    if (rest.every((t) => t.id === blankTabId)) await chrome.windows.remove(windowId).catch(() => {});
    else left++;
  }
  if (hidden && !left) await chrome.storage.session.remove(HIDDEN_KEY);
  return ids.size;
}

/** Removes the user's sites' pages from the browser's history. Returns how many. */
async function clearHistory(watched: string[]): Promise<number> {
  if (!chrome.history) return 0; // browsers without the history API (Safari)
  const items = await chrome.history.search({ text: '', startTime: 0, maxResults: 1_000_000 });
  const urls = items.map((i) => i.url).filter((url): url is string => isWatchUrl(url, watched));
  await Promise.all(urls.map((url) => chrome.history.deleteUrl({ url }).catch(() => {})));
  return urls.length;
}

/** The shortcut: closes the tabs on the user's sites. */
export async function closeWatching(): Promise<number> {
  return closeTabs(await sites());
}

/** The popup's button: closes those tabs, then removes the sites' pages from the browser's history. */
export async function wipeWatching(): Promise<{ tabs: number; pages: number }> {
  const watched = await sites();
  const tabs = await closeTabs(watched);
  return { tabs, pages: await clearHistory(watched) };
}
