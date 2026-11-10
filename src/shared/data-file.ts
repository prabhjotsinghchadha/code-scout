// Export and import: everything Code Scout keeps, as one JSON file (Settings → Backup). For a reinstall, or
// to move what's kept on this computer only (seen codes, visits, subtitle choices) to another one.
//
// Importing never trusts the file: only known keys are read, each entry is checked, and anything else is
// left out. Settings and the lists (quick links, sites) become the file's; favourites, seen codes and
// subtitle choices are added to what's here, so an import never removes a favourite.
import { actressesFrom, actressKey, isActressKey } from './actresses.ts';
import { formatCode, parseCode } from './codes.ts';
import { favouriteKey, favouritesFrom, isFavKey } from './favourites.ts';
import { siteKey } from './hosts.ts';
import { isWebUrl, validateTemplate, type OpenOnSite } from './open-on.ts';
import { MAX_GROUP_NAME, type QuickLink } from './quick-links.ts';
import { MAX_SEEN, SEEN_KEY, type Seen, type SeenEntry } from './seen.ts';
import { defaultSettings, seedBuiltIns, type Settings } from './storage.ts';
import { isAccent, isTheme } from './theme.ts';
import { isTagKey, tagKey, tagsFrom } from './tags.ts';
import { VISITS_KEY, type Visits } from './visits.ts';

export const FILE_APP = 'code-scout';
export const FILE_VERSION = 1;
/** Larger than any real export (2,000 seen codes are about 400 KB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** chrome.storage.sync holds this many items in all. */
const SYNC_MAX_ITEMS = 512;
const SEEDED_KEY = 'seededBuiltIns';
/** A subtitle file remembered for a code (content/cc-menu.ts): "cc:NSFS-484". */
const CC_PREFIX = 'cc:';
const MAX_TITLE = 100;
const MAX_URL = 2048;
const MAX_NAME = 100;

type Dump = Record<string, unknown>;

export interface DataFile {
  app: typeof FILE_APP;
  version: number;
  /** When it was exported (ISO date). */
  exported: string;
  /** From chrome.storage.sync: settings, the built-ins record, favourite videos, actresses and tags. */
  sync: Dump;
  /** From chrome.storage.local: seen codes, visits, subtitle choices. */
  local: Dump;
}

/** What an import did, for the message shown after it. */
export interface ImportCounts {
  /** Settings taken from the file (0 when it has none). */
  settings: number;
  favourites: number;
  actresses: number;
  tags: number;
  /** Favourites, actresses and tags in the file that were here already (left as they are). */
  alreadyHere: number;
  /** Seen codes new to this computer, or seen more recently in the file. */
  seen: number;
  subtitles: number;
}

export interface ImportPlan {
  sync: Dump;
  local: Dump;
  counts: ImportCounts;
}

const isObject = (v: unknown): v is Dump => !!v && typeof v === 'object' && !Array.isArray(v);
const isFavouriteKey = (key: string) => isFavKey(key) || isActressKey(key) || isTagKey(key);
const strings = (v: unknown[]) => v.filter((x): x is string => typeof x === 'string');
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// --- Export ---

/** The file for these dumps of sync and local storage: known keys only. */
export function makeDataFile(sync: Dump, local: Dump, now: number): DataFile {
  const keep = (dump: Dump, wanted: (key: string) => boolean) =>
    Object.fromEntries(Object.entries(dump).filter(([key]) => wanted(key)));
  return {
    app: FILE_APP,
    version: FILE_VERSION,
    exported: new Date(now).toISOString(),
    sync: keep(sync, (k) => k in defaultSettings || k === SEEDED_KEY || isFavouriteKey(k)),
    local: keep(local, (k) => k === SEEN_KEY || k === VISITS_KEY || k.startsWith(CC_PREFIX)),
  };
}

/** "code-scout-backup-2026-11-10.json" */
export function dataFileName(now: number): string {
  const d = new Date(now);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${FILE_APP}-backup-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`;
}

// --- Import ---

/** The file in `text`, or why it can't be imported. */
export function readDataFile(text: string): DataFile | { error: string } {
  if (text.length > MAX_FILE_BYTES) return { error: 'That file is too large to be a Code Scout backup.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'That file isn’t a Code Scout backup (it isn’t JSON).' };
  }
  if (!isObject(data) || data.app !== FILE_APP) return { error: 'That file isn’t a Code Scout backup.' };
  if (typeof data.version !== 'number' || data.version > FILE_VERSION) {
    return { error: 'That backup is from a newer Code Scout. Update the extension, then import it.' };
  }
  return {
    app: FILE_APP,
    version: data.version,
    exported: typeof data.exported === 'string' ? data.exported : '',
    sync: isObject(data.sync) ? data.sync : {},
    local: isObject(data.local) ? data.local : {},
  };
}

function quickLinks(value: unknown[]): QuickLink[] {
  return value.flatMap((v) => {
    if (!isObject(v) || typeof v.name !== 'string' || typeof v.url !== 'string') return [];
    if (!isWebUrl(v.url) || v.url.length > MAX_URL) return [];
    const link: QuickLink = { name: v.name.trim().slice(0, MAX_NAME) || v.url, url: v.url };
    if (typeof v.group === 'string' && v.group.trim()) link.group = v.group.trim().slice(0, MAX_GROUP_NAME);
    return [link];
  });
}

function openOnSites(value: unknown[]): OpenOnSite[] {
  const ids = new Set<string>();
  return value.flatMap((v) => {
    if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.template !== 'string') return [];
    if (!v.id || ids.has(v.id) || validateTemplate(v.template) || v.template.length > MAX_URL) return [];
    ids.add(v.id);
    return [{ id: v.id, name: v.name.trim().slice(0, MAX_NAME) || 'Site', template: v.template.trim() }];
  });
}

const hosts = (value: unknown[]) => [...new Set(strings(value).flatMap((s) => siteKey(s) ?? []))];
const groups = (value: unknown[]) => [...new Set(strings(value).map((g) => g.trim().slice(0, MAX_GROUP_NAME)).filter(Boolean))];

/** The settings in a file's sync part, checked one by one; ones missing or of the wrong kind are left out. */
export function settingsFrom(sync: Dump): Partial<Settings> {
  const out: Partial<Settings> = {};
  const bool = (key: 'inlineButtons' | 'fieldChip' | 'openInBackground' | 'videoTools' | 'playerKeys' | 'mostVisited' | 'rememberSeen') => {
    if (typeof sync[key] === 'boolean') out[key] = sync[key];
  };
  const list = <K extends keyof Settings>(key: K, clean: (value: unknown[]) => Settings[K]) => {
    if (Array.isArray(sync[key])) out[key] = clean(sync[key]);
  };
  const percent = (key: 'subSize' | 'subBackground', min: number, max: number) => {
    const n = sync[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = clamp(Math.round(n), min, max);
  };
  (['inlineButtons', 'fieldChip', 'openInBackground', 'videoTools', 'playerKeys', 'mostVisited', 'rememberSeen'] as const).forEach(bool);
  if (sync.openMode === 'video' || sync.openMode === 'search') out.openMode = sync.openMode;
  if (isTheme(sync.theme)) out.theme = sync.theme;
  if (isAccent(sync.accent)) out.accent = sync.accent;
  list('quickLinks', quickLinks);
  list('linkGroups', groups);
  list('openOnSites', openOnSites);
  list('offSites', hosts);
  list('popupBlockSites', hosts);
  list('videoOffSites', hosts);
  percent('subSize', 60, 200);
  percent('subBackground', 0, 100);
  return out;
}

/**
 * The favourite videos, actresses and tags in a file's sync part, as stored: each under its own key, tidied
 * the way the extension reads them. An entry under a key that isn't its own ("fav:nsfs484") is left out.
 */
export function favouritesIn(sync: Dump): { favourites: Dump; actresses: Dump; tags: Dump } {
  const out = { favourites: {} as Dump, actresses: {} as Dump, tags: {} as Dump };
  for (const [key, value] of Object.entries(sync)) {
    const one = { [key]: value };
    if (isFavKey(key)) {
      const [fav] = favouritesFrom(one);
      if (!fav || favouriteKey(fav) !== key) continue;
      const { added, title } = fav;
      const url = fav.code ? fav.url : undefined; // a page favourite's address is its key
      out.favourites[key] = { added, ...(url && url.length <= MAX_URL && { url }), ...(title && { title: title.slice(0, MAX_TITLE) }) };
    } else if (isActressKey(key)) {
      const [actress] = actressesFrom(one);
      if (actress && actressKey(actress.name) === key) out.actresses[key] = { ...actress, name: actress.name.slice(0, MAX_NAME) };
    } else if (isTagKey(key)) {
      const [tag] = tagsFrom(one);
      if (tag && tagKey(tag.name) === key) out.tags[key] = { ...tag, name: tag.name.slice(0, MAX_NAME) };
    }
  }
  return out;
}

/** The seen codes in a file, checked. */
export function seenFrom(value: unknown): Seen {
  const seen: Seen = {};
  if (!isObject(value)) return seen;
  for (const [key, v] of Object.entries(value)) {
    const code = parseCode(key);
    if (!code || formatCode(code) !== key || !isObject(v) || typeof v.at !== 'number' || !Number.isFinite(v.at)) continue;
    const entry: SeenEntry = { at: v.at };
    if (typeof v.url === 'string' && isWebUrl(v.url) && v.url.length <= MAX_URL) {
      entry.url = v.url;
      if (typeof v.title === 'string' && v.title) entry.title = v.title.slice(0, MAX_TITLE);
    }
    seen[key] = entry;
  }
  return seen;
}

/** Both lists as one: for a code in both, the one seen last; the most recent `max` in all. */
export function mergeSeen(here: Seen, file: Seen, max = MAX_SEEN): Seen {
  const all: Seen = { ...here };
  for (const [key, entry] of Object.entries(file)) {
    const mine = all[key];
    // The page a code was visited on is kept when the newer entry has none (it was only opened since).
    if (!mine) all[key] = entry;
    else if (entry.at > mine.at) all[key] = entry.url ? entry : { ...mine, at: entry.at };
    else if (!mine.url && entry.url) all[key] = { ...entry, at: mine.at };
  }
  const newest = Object.entries(all).sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(newest.slice(0, max));
}

function visitsFrom(value: unknown): Visits {
  const visits: Visits = {};
  if (!isObject(value)) return visits;
  for (const [site, v] of Object.entries(value)) {
    if (siteKey(site) !== site || !isObject(v)) continue;
    const { score, at } = v;
    if (typeof score === 'number' && typeof at === 'number' && Number.isFinite(score) && Number.isFinite(at) && score > 0) {
      visits[site] = { score, at };
    }
  }
  return visits;
}

/** Subtitle choices in a file's local part: "cc:NSFS-484" → the file picked and its timing. */
function subtitleChoices(local: Dump): Dump {
  const out: Dump = {};
  for (const [key, v] of Object.entries(local)) {
    if (!key.startsWith(CC_PREFIX) || !isObject(v)) continue;
    const code = parseCode(key.slice(CC_PREFIX.length));
    if (!code || CC_PREFIX + formatCode(code) !== key) continue;
    if (typeof v.url !== 'string' || v.url.length > MAX_URL || typeof v.offset !== 'number' || !Number.isFinite(v.offset)) continue;
    out[key] = { url: v.url, offset: v.offset };
  }
  return out;
}

/**
 * What importing `file` writes, given what's in storage now. Throws when the favourites wouldn't fit.
 *  - settings, quick links, groups and sites: the file's replace this computer's
 *  - favourite videos, actresses and tags: the file's are added; ones here already stay as they are
 *  - seen codes: both lists together (see mergeSeen); visits: per site, whichever was counted last
 *  - subtitle choices: the file's, for codes with none here
 */
export function planImport(file: DataFile, sync: Dump, local: Dump): ImportPlan {
  const settings = settingsFrom(file.sync);
  const found = favouritesIn(file.sync);
  const isNew = ([key]: [string, unknown]) => !(key in sync);
  const added = {
    favourites: Object.entries(found.favourites).filter(isNew),
    actresses: Object.entries(found.actresses).filter(isNew),
    tags: Object.entries(found.tags).filter(isNew),
  };
  const inFile = Object.keys(found.favourites).length + Object.keys(found.actresses).length + Object.keys(found.tags).length;
  const newCount = added.favourites.length + added.actresses.length + added.tags.length;

  const syncPatch: Dump = { ...settings, ...Object.fromEntries([...added.favourites, ...added.actresses, ...added.tags]) };
  const localPatch: Dump = {};

  // The file's links come with its record of the built-ins it was offered, so ones removed there stay
  // removed here, and ones newer than the file are still offered (seedBuiltIns, after the import).
  const record = file.sync[SEEDED_KEY];
  if (settings.quickLinks && Array.isArray(record)) {
    const offered = [...new Set(strings(record))];
    syncPatch[SEEDED_KEY] = offered;
    localPatch[SEEDED_KEY] = offered;
    localPatch.quickLinksSeedVersion = 0;
  }

  const items = new Set([...Object.keys(sync), ...Object.keys(syncPatch)]).size;
  if (items > SYNC_MAX_ITEMS) {
    const over = items - SYNC_MAX_ITEMS;
    throw new Error(`The file has ${over} more favourite${over === 1 ? '' : 's'} than fit here. Remove some favourites, then import again.`);
  }

  const seenHere = seenFrom(local[SEEN_KEY]);
  const seenInFile = seenFrom(file.local[SEEN_KEY]);
  const seenCount = Object.entries(seenInFile).filter(([key, e]) => !seenHere[key] || e.at > seenHere[key].at).length;
  if (seenCount) localPatch[SEEN_KEY] = mergeSeen(seenHere, seenInFile);

  const visitsInFile = visitsFrom(file.local[VISITS_KEY]);
  if (Object.keys(visitsInFile).length) {
    const visits = visitsFrom(local[VISITS_KEY]);
    for (const [site, v] of Object.entries(visitsInFile)) if (!visits[site] || v.at > visits[site].at) visits[site] = v;
    localPatch[VISITS_KEY] = visits;
  }

  const choices = Object.entries(subtitleChoices(file.local)).filter(([key]) => !(key in local));
  Object.assign(localPatch, Object.fromEntries(choices));

  return {
    sync: syncPatch,
    local: localPatch,
    counts: {
      settings: Object.keys(settings).length,
      favourites: added.favourites.length,
      actresses: added.actresses.length,
      tags: added.tags.length,
      alreadyHere: inFile - newCount,
      seen: seenCount,
      subtitles: choices.length,
    },
  };
}

/** "Imported settings, 12 favourites, 2 actresses and 240 seen codes. 3 favourites were here already." */
export function importSummary(c: ImportCounts): string {
  const n = (count: number, one: string, many = `${one}s`) => (count ? [`${count.toLocaleString()} ${count === 1 ? one : many}`] : []);
  const parts = [
    ...(c.settings ? ['settings'] : []),
    ...n(c.favourites, 'favourite'),
    ...n(c.actresses, 'actress', 'actresses'),
    ...n(c.tags, 'tag'),
    ...n(c.seen, 'seen code'),
    ...n(c.subtitles, 'subtitle choice'),
  ];
  const already = c.alreadyHere ? ` ${n(c.alreadyHere, 'favourite')[0]} ${c.alreadyHere === 1 ? 'was' : 'were'} here already.` : '';
  if (!parts.length) return c.alreadyHere ? `Nothing new in that file.${already}` : 'Nothing to import in that file.';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Imported ${list}.${already}`;
}

// --- chrome.storage ---

export async function exportData(now = Date.now()): Promise<DataFile> {
  const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
  return makeDataFile(sync, local, now);
}

/** Imports a file's text (see planImport). Throws with a message to show when it can't. */
export async function importData(text: string): Promise<ImportCounts> {
  const file = readDataFile(text);
  if ('error' in file) throw new Error(file.error);
  const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
  const plan = planImport(file, sync, local);
  // Sync first, in one write: all of it lands or none does, and nothing local is changed if it fails.
  try {
    if (Object.keys(plan.sync).length) await chrome.storage.sync.set(plan.sync);
  } catch (err) {
    throw new Error(
      /quota|max_items/i.test(String(err))
        ? 'The file doesn’t fit in Chrome’s synced storage. Remove some favourites or quick links, then import again.'
        : 'Couldn’t save the imported data.',
    );
  }
  if (Object.keys(plan.local).length) await chrome.storage.local.set(plan.local);
  // Built-in sites added since the file was made.
  await seedBuiltIns().catch((err) => console.warn('Offering built-ins failed', err));
  return plan.counts;
}
