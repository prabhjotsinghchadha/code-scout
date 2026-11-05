// A copy of the favourites in a bookmarks folder, "Code Scout favourites". Removing the extension
// deletes all of its storage, the synced copy included, but not your bookmarks; so after a reinstall the
// favourites come back from the folder. With bookmark sync on, the folder is in your Google account too.
//
// The folder is only ever added to, except for what you un-star on this device (noted in local storage):
// a favourite deleted because the extension's storage was wiped (removed here or on a synced device) stays
// in the backup. Runs in the background only (chrome.bookmarks).
//
// Favourite actresses go in a folder inside it, "Actresses": each is her name, linking to her page. Favourite
// tags go in "Tags": a bookmark per tag page, titled with the tag ("NTR" → MissAV's page, "NTR" → javtrailers').
import { actressKey, actressLink, cleanName, getActresses, makeActress, type Actress } from './actresses.ts';
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
import { getTags, makeTag, tagKey, tagLinks, tagOfPageKey, tagPageKey, type Tag } from './tags.ts';

export const BACKUP_FOLDER = 'Code Scout favourites';
/** The folder for favourite actresses, inside BACKUP_FOLDER. */
export const ACTRESS_FOLDER = 'Actresses';
/** The folder for favourite tags, inside BACKUP_FOLDER. */
export const TAG_FOLDER = 'Tags';
/** The folder's names from before the extension was renamed; found and renamed to BACKUP_FOLDER. */
const OLD_FOLDERS = ['JAV Trailer Opener favourites'];
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

/** An actress as "Yua Mikami" linking to her page (or the javtrailers search for her name). */
export function actressBookmark(actress: Actress): BookmarkData {
  return { title: actress.name, url: actressLink(actress) };
}

/** The actress a bookmark in the Actresses folder stands for (its title is her name), saved at `added`. */
export function fromActressBookmark(node: BackupNode, added: number): { key: string; data: Actress } | null {
  const name = cleanName(node.title);
  const page = node.url ? pageUrl(node.url) : null;
  if (!name || !page) return null;
  // The search for her name is what the backup links to when no page was saved.
  return { key: actressKey(name), data: makeActress(name, isTrailerSearch(page) ? null : node.url, added) };
}

/** A javtrailers search: what the backup links to for an actress or tag with no page saved. */
function isTrailerSearch(url: string): boolean {
  return onJavTrailers(url) && new URL(url).pathname.startsWith('/search/');
}

/** One bookmark of a tag's: one of its pages (or its search, when it has none). */
interface TagBookmark {
  tag: Tag;
  url: string;
}

/** A bookmark per tag page, titled with the tag; newest tag first, each tag's pages last to first (see plan). */
export function tagBookmarks(tags: Tag[]): TagBookmark[] {
  return tags.flatMap((tag) => [...tagLinks(tag)].reverse().map((url) => ({ tag, url })));
}

/**
 * The tag page a bookmark in the Tags folder stands for: its title is the tag, its address the page (none
 * when it's the javtrailers search). The key is the tag's and the page's ("tag:ntr|https://…").
 */
export function fromTagBookmark(node: BackupNode): { key: string; name: string; page: string | null } | null {
  const name = cleanName(node.title);
  const url = node.url ? pageUrl(node.url) : null;
  if (!name || !url) return null;
  return { key: tagPageKey(name, url), name, page: isTrailerSearch(url) ? null : url };
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
  return plan(favs, favouriteKey, toBookmark, nodes, (n) => fromBookmark(n, 0)?.key, (k) => unstarred.has(k));
}

/** The same for the favourite actresses and the bookmarks in the Actresses folder. */
export function planActressBackup(actresses: Actress[], nodes: BackupNode[], unstarred: Set<string>): BackupPlan {
  const key = (a: Actress) => actressKey(a.name);
  return plan(actresses, key, actressBookmark, nodes, (n) => fromActressBookmark(n, 0)?.key, (k) => unstarred.has(k));
}

/**
 * The same for the favourite tags and the bookmarks in the Tags folder, a bookmark per tag page. A page goes
 * when it or its whole tag was un-starred here, and a tag's search bookmark goes once the tag has pages.
 */
export function planTagBackup(tags: Tag[], nodes: BackupNode[], unstarred: Set<string>): BackupPlan {
  const withPages = new Set(tags.filter((t) => t.pages.length).map((t) => tagKey(t.name)));
  const gone = (key: string) => {
    const tag = tagOfPageKey(key);
    const url = key.slice(tag.length + 1);
    return unstarred.has(key) || unstarred.has(tag) || (isTrailerSearch(url) && withPages.has(tag));
  };
  const keyOf = (b: TagBookmark) => tagPageKey(b.tag.name, b.url);
  const bookmark = (b: TagBookmark) => ({ title: b.tag.name, url: b.url });
  return plan(tagBookmarks(tags), keyOf, bookmark, nodes, (n) => fromTagBookmark(n)?.key, gone);
}

/**
 * `items` newest first; `keyOf` and `nodeKey` give the key an item or a bookmark stands for; `gone(key)` says
 * a bookmark that isn't wanted any more can be deleted (it was un-starred here).
 */
function plan<T>(
  items: T[],
  keyOf: (item: T) => string,
  bookmark: (item: T) => BookmarkData,
  nodes: BackupNode[],
  nodeKey: (node: BackupNode) => string | undefined,
  gone: (key: string) => boolean,
): BackupPlan {
  const wanted = new Set(items.map(keyOf));
  const kept = new Set<string>();
  const remove: string[] = [];
  const oldestFirst = [...nodes].sort((a, b) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0) || a.id.localeCompare(b.id));
  for (const node of oldestFirst) {
    const key = nodeKey(node);
    if (!key) continue;
    if (kept.has(key) || (gone(key) && !wanted.has(key))) remove.push(node.id);
    else kept.add(key);
  }
  const create = items
    .filter((item) => !kept.has(keyOf(item)))
    .reverse()
    .map(bookmark);
  return { create, remove };
}

/** Sync-storage entries for the favourites in the backup, in folder order (oldest first); first copy wins. */
export function restorePatch(nodes: BackupNode[]): Record<string, FavouriteData> {
  return patchFrom(nodes, fromBookmark);
}

/** The same for the bookmarks in the Actresses folder. */
export function restoreActressPatch(nodes: BackupNode[]): Record<string, Actress> {
  return patchFrom(nodes, fromActressBookmark);
}

/** The same for the bookmarks in the Tags folder: each tag with its pages, in folder order. */
export function restoreTagPatch(nodes: BackupNode[]): Record<string, Tag> {
  const found = new Map<string, { name: string; pages: string[]; added: number }>();
  nodes.forEach((node, i) => {
    const b = fromTagBookmark(node);
    if (!b) return;
    const key = tagKey(b.name);
    const tag = found.get(key) ?? { name: b.name, pages: [], added: (node.dateAdded ?? 0) + i };
    if (b.page) tag.pages.push(b.page);
    found.set(key, tag);
  });
  return Object.fromEntries([...found].map(([key, t]) => [key, makeTag(t.name, t.pages, t.added)]));
}

function patchFrom<T>(nodes: BackupNode[], from: (node: BackupNode, added: number) => { key: string; data: T } | null) {
  const patch: Record<string, T> = {};
  nodes.forEach((node, i) => {
    // Bookmarks added in one go can share a timestamp; adding the position keeps them in order.
    const item = from(node, (node.dateAdded ?? 0) + i);
    if (item && !(item.key in patch)) patch[item.key] = item.data;
  });
  return patch;
}

// --- chrome.bookmarks ---

type Node = chrome.bookmarks.BookmarkTreeNode;
const oldestFirst = (a: Node, b: Node) => (a.dateAdded ?? 0) - (b.dateAdded ?? 0);

/**
 * The backup folders, wherever you moved them (normally one; a synced device can add a second before the
 * first arrives), oldest first, and the bookmarks in them; the same for the Actresses folders in them.
 */
async function backup() {
  const folders: Node[] = [];
  const walk = (n: Node) => {
    if (!n.url && (n.title === BACKUP_FOLDER || OLD_FOLDERS.includes(n.title))) folders.push(n);
    else n.children?.forEach(walk);
  };
  (await chrome.bookmarks.getTree()).forEach(walk);
  folders.sort(oldestFirst);
  const nodes = folders.flatMap((f) => f.children ?? []);
  const inner = (title: string) => nodes.filter((n) => !n.url && n.title === title).sort(oldestFirst);
  const actressFolders = inner(ACTRESS_FOLDER);
  const tagFolders = inner(TAG_FOLDER);
  return {
    folders,
    nodes,
    actressFolders,
    actressNodes: actressFolders.flatMap((f) => f.children ?? []),
    tagFolders,
    tagNodes: tagFolders.flatMap((f) => f.children ?? []),
  };
}

async function createAll(parentId: string, bookmarks: BookmarkData[]) {
  for (const bookmark of bookmarks) {
    await chrome.bookmarks.create({ parentId, ...bookmark }).catch((err) => console.warn('Not backed up:', bookmark.url, err));
  }
}

/** Brings the backup folder up to date with the favourites (see planBackup), creating it when needed. */
export async function updateBackup(): Promise<void> {
  // Read the un-stars first: one made while this runs is handled by the next run.
  const markers = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith(UNSTARRED_PREFIX));
  const unstarred = new Set(markers.map((k) => k.slice(UNSTARRED_PREFIX.length)));
  const [favs, actresses, tags, b] = await Promise.all([getFavourites(), getActresses(), getTags(), backup()]);
  for (const f of b.folders) if (f.title !== BACKUP_FOLDER) await chrome.bookmarks.update(f.id, { title: BACKUP_FOLDER });
  const videos = planBackup(favs, b.nodes, unstarred);
  const people = planActressBackup(actresses, b.actressNodes, unstarred);
  const tagPlan = planTagBackup(tags, b.tagNodes, unstarred);
  for (const id of [...videos.remove, ...people.remove, ...tagPlan.remove]) {
    await chrome.bookmarks.remove(id).catch(() => {}); // already gone (synced)
  }
  if (videos.create.length || people.create.length || tagPlan.create.length) {
    const parentId = b.folders[0]?.id ?? (await chrome.bookmarks.create({ title: BACKUP_FOLDER })).id;
    await createAll(parentId, videos.create);
    // The inner folders are made the first time they have something in them.
    const inner = async (folders: Node[], title: string, create: BookmarkData[]) => {
      if (!create.length) return;
      await createAll(folders[0]?.id ?? (await chrome.bookmarks.create({ parentId, title })).id, create);
    };
    await inner(b.actressFolders, ACTRESS_FOLDER, people.create);
    await inner(b.tagFolders, TAG_FOLDER, tagPlan.create);
  }
  if (markers.length) await chrome.storage.local.remove(markers);
}

/**
 * After a reinstall (or a wipe): when there are no favourite videos but the backup has some, puts them
 * back; the same for the favourite actresses and tags, each on their own. Run updateBackup first, so
 * un-stars not yet backed up aren't brought back. True if it restored any.
 */
export async function restoreFromBackup(): Promise<boolean> {
  const [favs, actresses, tags, b] = await Promise.all([getFavourites(), getActresses(), getTags(), backup()]);
  const patch = {
    ...(favs.length ? {} : restorePatch(b.nodes)),
    ...(actresses.length ? {} : restoreActressPatch(b.actressNodes)),
    ...(tags.length ? {} : restoreTagPatch(b.tagNodes)),
  };
  if (!Object.keys(patch).length) return false;
  await chrome.storage.sync.set(patch);
  return true;
}
