// "Hide what I'm watching": one shortcut (or the popup's eye button) pauses every video, mutes the tabs
// being watched and moves them out of sight; the same again brings them back where they were.
//
// Out of sight = moved to a minimised window whose own tab in front is a blank page. The tabs stay loaded
// (a video keeps its place), unlike closing them, and nothing of them is left in the tab strip, unlike
// just switching to another tab. Which tabs: shared/hide.ts, plus the tab in front and any tab that had a
// video playing.
import { isWatchTab, watchSites } from '../shared/hide';
import { getSettings } from '../shared/storage';

/** In session storage: tab ids only mean something until the browser closes. */
export const HIDDEN_KEY = 'hiddenTabs';

interface HiddenTab {
  id: number;
  windowId: number;
  index: number;
  pinned: boolean;
  active: boolean;
  /** Muted by hiding it (not by the user before), so unmuted when it's back. */
  muted: boolean;
}

interface Hidden {
  tabs: HiddenTab[];
  /** The minimised windows the tabs are in (one for incognito tabs), each with the blank tab it opened with. */
  stashes: { windowId: number; blankTabId?: number; incognito: boolean }[];
  /** New tabs opened in windows that would otherwise have been left with no tab (and closed). */
  placeholders: number[];
}

/** How long to wait for pages to answer the pause, before hiding the tabs that had a video playing. */
const PAUSE_WAIT_MS = 600;

const isWeb = (url?: string) => !!url && /^https?:/.test(url);

/**
 * Runs in every frame of a tab: pauses what's playing, and leaves full screen and picture-in-picture (a
 * floating video would stay on screen). Returns whether anything was playing.
 */
function pauseMedia(): boolean {
  let playing = false;
  for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (media.paused || media.ended) continue;
    playing = true;
    media.pause();
  }
  if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  return playing;
}

/** Pauses a tab's videos; true if one was playing. Pages that can't be scripted answer false. */
async function pauseTab(tabId: number): Promise<boolean> {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: pauseMedia });
    return results.some((r) => r.result === true);
  } catch {
    return false;
  }
}

async function read(): Promise<Hidden | null> {
  const stored = await chrome.storage.session.get<{ [HIDDEN_KEY]?: Hidden }>(HIDDEN_KEY);
  return stored[HIDDEN_KEY] ?? null;
}

/** Moves `tabs` into the minimised window, muting them, and notes where they were in `state`. */
async function stash(tabs: chrome.tabs.Tab[], state: Hidden) {
  const known = new Set(state.tabs.map((t) => t.id));
  tabs = tabs.filter((t) => t.id !== undefined && !known.has(t.id));
  if (!tabs.length) return;

  for (const tab of tabs) {
    const muted = !tab.mutedInfo?.muted;
    if (muted) void chrome.tabs.update(tab.id!, { muted: true }).catch(() => {});
    state.tabs.push({ id: tab.id!, windowId: tab.windowId, index: tab.index, pinned: tab.pinned, active: tab.active, muted });
  }

  // A window about to lose all its tabs would close: give it a new tab first, so it stays (and has
  // something plain in front).
  const hiding = new Set(state.tabs.map((t) => t.id));
  for (const windowId of new Set(tabs.map((t) => t.windowId))) {
    const left = (await chrome.tabs.query({ windowId })).filter((t) => !hiding.has(t.id!));
    if (left.length) continue;
    const placeholder = await chrome.tabs.create({ windowId, active: true });
    if (placeholder.id !== undefined) state.placeholders.push(placeholder.id);
  }

  for (const incognito of [false, true]) {
    const ids = tabs.filter((t) => t.incognito === incognito).map((t) => t.id!);
    if (!ids.length) continue;
    let home = state.stashes.find((s) => s.incognito === incognito);
    if (!home) {
      const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', incognito });
      if (win?.id === undefined) continue;
      home = { windowId: win.id, blankTabId: win.tabs?.[0]?.id, incognito };
      state.stashes.push(home);
    }
    // Moved tabs aren't brought to the front there: the blank tab stays the one showing.
    await chrome.tabs.move(ids, { windowId: home.windowId, index: -1 }).catch(() => {});
  }
  await chrome.storage.session.set({ [HIDDEN_KEY]: state });
}

async function hide() {
  const [tabs, settings, focused] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }),
    getSettings(),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null),
  ]);
  const sites = watchSites(settings);
  const state: Hidden = { tabs: [], stashes: [], placeholders: [] };

  // Every page is asked to pause at once; the tabs known to be watched don't wait for the answers.
  const scripted = tabs.filter((t) => t.id !== undefined && isWeb(t.url) && !t.discarded);
  const playing = new Set<number>();
  const paused = Promise.all(scripted.map(async (t) => (await pauseTab(t.id!)) && playing.add(t.id!)));

  // The tab in front is what's on screen: hidden whatever it is.
  const inFront = (t: chrome.tabs.Tab) => t.active && t.windowId === focused?.id && isWeb(t.url);
  await stash(tabs.filter((t) => isWatchTab(t, sites) || inFront(t)), state);

  await Promise.race([paused, new Promise((r) => setTimeout(r, PAUSE_WAIT_MS))]);
  // From the same list as the first lot, so each tab's place is the one it had before any were moved.
  await stash(tabs.filter((t) => playing.has(t.id!)), state);
}

/** Puts the hidden tabs back in their windows and places, still paused. */
async function restore(state: Hidden) {
  const stashIds = new Set(state.stashes.map((s) => s.windowId));
  /** Windows closed since (by the user): their tabs go to a new one. */
  const moved = new Map<number, number>();
  // Lowest place first, so each tab lands where it was.
  for (const saved of [...state.tabs].sort((a, b) => a.index - b.index)) {
    try {
      const tab = await chrome.tabs.get(saved.id);
      if (!stashIds.has(tab.windowId)) continue; // dragged out of the hidden window: it's where the user wants it
      const windowId = moved.get(saved.windowId) ?? saved.windowId;
      const there = await chrome.windows.get(windowId).catch(() => null);
      if (there) {
        await chrome.tabs.move(saved.id, { windowId, index: saved.index });
      } else {
        const win = await chrome.windows.create({ tabId: saved.id, incognito: tab.incognito });
        if (win?.id !== undefined) moved.set(saved.windowId, win.id);
      }
      await chrome.tabs.update(saved.id, { ...(saved.pinned && { pinned: true }), ...(saved.muted && { muted: false }) });
    } catch {
      // Closed while hidden.
    }
  }
  for (const saved of state.tabs) {
    if (saved.active) await chrome.tabs.update(saved.id, { active: true }).catch(() => {});
  }
  // The stand-in new tabs go, unless they've been used since.
  for (const id of state.placeholders) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab && !isWeb(tab.url) && !isWeb(tab.pendingUrl)) await chrome.tabs.remove(id).catch(() => {});
  }
  // And the hidden windows, unless something else was opened in them.
  for (const { windowId, blankTabId } of state.stashes) {
    const left = await chrome.tabs.query({ windowId }).catch(() => []);
    if (left.every((t) => t.id === blankTabId)) await chrome.windows.remove(windowId).catch(() => {});
  }
  await chrome.storage.session.remove(HIDDEN_KEY);
}

/** Tabs still waiting in a hidden window? (Not if the user has since closed it or taken them all out.) */
async function stillHidden(state: Hidden): Promise<boolean> {
  const stashIds = new Set(state.stashes.map((s) => s.windowId));
  const tabs = await Promise.all(state.tabs.map((t) => chrome.tabs.get(t.id).catch(() => null)));
  return tabs.some((t) => t && stashIds.has(t.windowId));
}

let busy: Promise<void> = Promise.resolve();

/** Hide what's being watched, or bring it back if it's hidden. One at a time: a second press waits. */
export function toggleHidden(): Promise<void> {
  busy = busy
    .then(async () => {
      const state = await read();
      if (state && (await stillHidden(state))) return restore(state);
      if (state) await restore(state); // nothing left to bring back: clears up what the last time left
      await hide();
    })
    .catch((err) => console.warn('Hide:', err));
  return busy;
}
