// A copy of the favourites in a bookmarks folder, "JAV Trailer Opener favourites". Removing the extension
// deletes all of its storage, the synced copy included, but not your bookmarks; so after a reinstall the
// favourites come back from the folder. With bookmark sync on, the folder is in your Google account too.
//
// The folder is only ever added to, except for what you un-star on this device (noted in local storage):
// a favourite deleted because the extension's storage was wiped (removed here or on a synced device) stays
// in the backup. Runs in the background only (chrome.bookmarks).
import { codeInUrl, formatCode, parseCode, searchUrl } from './codes.ts';
import {
  favKey,
  favouriteKey,
  getFavourites,
  makeFavourite,
  pageKey,
  pageUrl,
  UNSTARRED_PREFIX,
  type Favourite,
  type FavouriteData,
} from './favourites.ts';

export const BACKUP_FOLDER = 'JAV Trailer Opener favourites';
const SEP = ' · ';

export interface BookmarkData {
  title: string;
  url: string;
}

/** The parts of a bookmark the backup reads (a chrome.bookmarks.BookmarkTreeNode fits). */
export interface BackupNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
}

function onJavTrailers(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('javtrailers.com');
  } catch {
    return false;
  }
}

/**
 * A code as "NSFS-484 · Page title" linking to the page it was starred on (or its javtrailers search when no
 * page was saved); a page as itself.
 */
export function toBookmark(fav: Favourite): BookmarkData {
  if (!fav.code) return { title: fav.title || fav.url, url: fav.url };
  const code = formatCode(fav.code);
  return { title: fav.title ? code + SEP + fav.title : code, url: fav.url ?? searchUrl(fav.code) };
}

/**
 * The favourite a bookmark stands for, as its sync key and what to store under it (starred at `added`).
 * A title starting with a code exactly as the backup writes it ("NSFS-484") is that code; any other web
 * bookmark is a page, or the code in its address ("/videos/MD0273") as when starring that page. Null for
 * folders and non-web bookmarks.
 */
export function fromBookmark(node: BackupNode, added: number): { key: string; data: FavouriteData } | null {
  if (!node.url) return null;
  const [head, ...rest] = node.title.split(SEP);
  const code = parseCode(head);
  if (code && formatCode(code) === head) {
    const page = onJavTrailers(node.url) ? null : { url: node.url, title: rest.join(SEP) };
    return { key: favKey(code), data: makeFavourite(page, added) };
  }
  const fromUrl = codeInUrl(node.url);
  if (fromUrl) return { key: favKey(fromUrl), data: makeFavourite({ url: node.url, title: node.title }, added) };
  const page = pageUrl(node.url);
  if (!page) return null;
  // A page saved without a title is backed up with its address as the title.
  const untitled = node.title === node.url || node.title === page;
  const { title } = makeFavourite({ url: page, title: untitled ? '' : node.title }, added);
  const key = pageKey(page)!;
  return { key, data: { added, ...(title && { title }) } };
}

export interface BackupPlan {
  /** Bookmarks to add, oldest favourite first. */
  create: BookmarkData[];
  /** Ids of bookmarks to delete. */
  remove: string[];
}

/**
 * What brings the backup up to date: add the favourites it lacks, delete extra copies of one (keeping the
 * oldest, so synced devices keep the same one), and delete what was un-starred on this device (`unstarred`:
 * sync keys) unless it's a favourite again. Everything else in the folder stays.
 */
export function planBackup(favs: Favourite[], nodes: BackupNode[], unstarred: Set<string>): BackupPlan {
  const wanted = new Set(favs.map(favouriteKey));
  const kept = new Set<string>();
  const remove: string[] = [];
  const oldestFirst = [...nodes].sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0) || a.id.localeCompare(b.id));
  for (const node of oldestFirst) {
    const key = fromBookmark(node, 0)?.key;
    if (!key) continue;
    if (kept.has(key) || (unstarred.has(key) && !wanted.has(key))) remove.push(node.id);
    else kept.add(key);
  }
  const create = favs
    .filter((f) => !kept.has(favouriteKey(f)))
    .reverse()
    .map(toBookmark);
  return { create, remove };
}

/** Sync-storage entries for the favourites in the backup, in folder order (oldest first); first copy wins. */
export function restorePatch(nodes: BackupNode[]): Record<string, FavouriteData> {
  const patch: Record<string, FavouriteData> = {};
  nodes.forEach((node, i) => {
    // Bookmarks added in one go can share a timestamp; adding the position keeps them in order.
    const fav = fromBookmark(node, (node.dateAdded ?? 0) + i);
    if (fav && !(fav.key in patch)) patch[fav.key] = fav.data;
  });
  return patch;
}

// --- chrome.bookmarks ---

/**
 * The backup folders, wherever you moved them (normally one; a synced device can add a second before the
 * first arrives), oldest first, and the bookmarks in them.
 */
async function backup(): Promise<{ folders: BackupNode[]; nodes: BackupNode[] }> {
  const folders: chrome.bookmarks.BookmarkTreeNode[] = [];
  const walk = (n: chrome.bookmarks.BookmarkTreeNode) => {
    if (!n.url && n.title === BACKUP_FOLDER) folders.push(n);
    else n.children?.forEach(walk);
  };
  (await chrome.bookmarks.getTree()).forEach(walk);
  folders.sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0));
  return { folders, nodes: folders.flatMap((f) => f.children ?? []) };
}

/** Brings the backup folder up to date with the favourites (see planBackup), creating it when needed. */
export async function updateBackup(): Promise<void> {
  // Read the un-stars first: one made while this runs is handled by the next run.
  const markers = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith(UNSTARRED_PREFIX));
  const unstarred = new Set(markers.map((k) => k.slice(UNSTARRED_PREFIX.length)));
  const [favs, { folders, nodes }] = await Promise.all([getFavourites(), backup()]);
  const { create, remove } = planBackup(favs, nodes, unstarred);
  for (const id of remove) await chrome.bookmarks.remove(id).catch(() => {}); // already gone (synced)
  if (create.length) {
    const parentId = folders[0]?.id ?? (await chrome.bookmarks.create({ title: BACKUP_FOLDER })).id;
    for (const bookmark of create) {
      await chrome.bookmarks.create({ parentId, ...bookmark }).catch((err) => console.warn('Not backed up:', bookmark.url, err));
    }
  }
  if (markers.length) await chrome.storage.local.remove(markers);
}

/**
 * After a reinstall (or a wipe): when there are no favourites but the backup has some, puts them back.
 * Run updateBackup first, so un-stars not yet backed up aren't brought back. True if it restored any.
 */
export async function restoreFromBackup(): Promise<boolean> {
  if ((await getFavourites()).length) return false;
  const patch = restorePatch((await backup()).nodes);
  if (!Object.keys(patch).length) return false;
  await chrome.storage.sync.set(patch);
  return true;
}
