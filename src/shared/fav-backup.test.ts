import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_FOLDER,
  fromBookmark,
  planBackup,
  restoreFromBackup,
  restorePatch,
  toBookmark,
  updateBackup,
  type BackupNode,
} from './fav-backup.ts';
import { addFavourite, addPageFavourite, favouritesFrom, getFavourites, toggleFavourite } from './favourites.ts';

const nsfs = { prefix: 'nsfs', number: 484 };
const md = { prefix: 'md', number: 273 };
const favs = favouritesFrom({
  'fav:NSFS-484': { added: 3, url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484 Title' },
  'favurl:https://x.example/v?id=1': { added: 2, title: 'Some video' },
  'fav:MD-273': { added: 1 },
});
const node = (id: string, title: string, url?: string, dateAdded = 0): BackupNode => ({ id, title, url, dateAdded });

test('favourites as bookmarks and back', () => {
  assert.deepEqual(favs.map(toBookmark), [
    { title: 'NSFS-484 · NSFS-484 Title', url: 'https://missav.ws/en/nsfs-484' },
    { title: 'Some video', url: 'https://x.example/v?id=1' },
    { title: 'MD-273', url: 'https://javtrailers.com/search/md-273' }, // no page saved
  ]);
  const back = favs.map((f, i) => fromBookmark({ id: String(i), ...toBookmark(f) }, f.added));
  assert.deepEqual(favouritesFrom(Object.fromEntries(back.map((b) => [b!.key, b!.data]))), favs);
});

test('only titles that start with a code as written count as codes', () => {
  // "MD0273 …" isn't "MD-273", so it's a page, unless the address is the code's (as when starring that page).
  assert.deepEqual(fromBookmark(node('1', 'MD0273 Training', 'https://18jav.tv/videos/MD0273'), 5), {
    key: 'fav:MD-273',
    data: { added: 5, url: 'https://18jav.tv/videos/MD0273', title: 'MD0273 Training' },
  });
  assert.equal(fromBookmark(node('1', 'MD0273 Training', 'https://18jav.tv/x'), 5)?.key, 'favurl:https://18jav.tv/x');
  // A folder or a non-web bookmark is nothing.
  assert.equal(fromBookmark(node('1', 'A folder'), 5), null);
  assert.equal(fromBookmark(node('1', 'js', 'javascript:alert(1)'), 5), null);
  assert.deepEqual(fromBookmark(node('1', 'https://y.example/', 'https://y.example/#top'), 5), {
    key: 'favurl:https://y.example/',
    data: { added: 5 },
  });
});

test('planBackup adds what is missing and only deletes copies and un-stars', () => {
  const nodes = [
    node('10', 'NSFS-484 · old title', 'https://missav.ws/en/nsfs-484', 100),
    node('11', 'NSFS-484', 'https://javtrailers.com/search/nsfs-484', 200), // a second copy
    node('12', 'SSIS-001', 'https://javtrailers.com/search/ssis-001', 150), // un-starred here
    node('13', 'IPX-123', 'https://javtrailers.com/search/ipx-123', 160), // gone from favourites some other way
    node('14', 'Folder inside'),
  ];
  const plan = planBackup(favs, nodes, new Set(['fav:SSIS-001', 'fav:MD-273']));
  assert.deepEqual(plan.remove, ['12', '11']);
  assert.deepEqual(
    plan.create.map((b) => b.title),
    ['MD-273', 'Some video'], // oldest first; MD-273 was re-starred after its un-star
  );
  // A wiped storage (no favourites) deletes nothing.
  assert.deepEqual(planBackup([], nodes, new Set()), { create: [], remove: ['11'] });
});

test('restorePatch keeps folder order and the first copy', () => {
  const patch = restorePatch([
    node('1', 'MD-273', 'https://javtrailers.com/search/md-273', 50),
    node('2', 'NSFS-484 · T', 'https://missav.ws/en/nsfs-484', 50),
    node('3', 'NSFS-484', 'https://javtrailers.com/search/nsfs-484', 60),
  ]);
  assert.deepEqual(patch, {
    'fav:MD-273': { added: 50 },
    'fav:NSFS-484': { added: 51, url: 'https://missav.ws/en/nsfs-484', title: 'T' },
  });
});

function fakeChrome() {
  const sync: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const marks: (BackupNode & { parentId: string })[] = [];
  let nextId = 1;
  let clock = 1000;
  const area = (data: Record<string, unknown>) => ({
    async get(keys: string | string[] | null) {
      if (keys === null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(patch: Record<string, unknown>) {
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys: string | string[]) {
      for (const k of ([] as string[]).concat(keys)) delete data[k];
    },
  });
  type Mark = BackupNode & { parentId?: string; children?: Mark[] };
  const tree = (id: string, title: string): Mark => {
    const children = marks.filter((m) => m.parentId === id).map((m) => (m.url ? { ...m } : tree(m.id, m.title)));
    return { ...marks.find((m) => m.id === id), id, title, children };
  };
  const bookmarks = {
    async getTree() {
      return [{ id: '0', title: '', children: [tree('bar', 'Bookmarks bar'), tree('other', 'Other bookmarks')] }];
    },
    async create({ parentId = 'other', title, url }: { parentId?: string; title: string; url?: string }) {
      const m = { id: String(nextId++), parentId, title, url, dateAdded: clock++ };
      marks.push(m);
      return m;
    },
    async update(id: string, { title }: { title: string }) {
      marks.find((m) => m.id === id)!.title = title;
    },
    async remove(id: string) {
      const i = marks.findIndex((m) => m.id === id);
      if (i < 0) throw new Error("Can't find bookmark for id.");
      marks.splice(i, 1);
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: area(sync), local: area(local) }, bookmarks };
  const wipe = () => [sync, local].forEach((d) => Object.keys(d).forEach((k) => delete d[k]));
  const inFolder = () => {
    const folder = marks.find((m) => m.title === BACKUP_FOLDER && !m.url)!;
    return marks.filter((m) => m.parentId === folder.id).map((m) => m.title);
  };
  return { sync, local, marks, wipe, inFolder };
}

test('backup survives a wipe and brings favourites back; un-starring here removes the bookmark', async () => {
  const c = fakeChrome();
  await updateBackup();
  assert.equal(c.marks.length, 0); // no favourites, no folder

  await addFavourite(md, null, 1);
  await addPageFavourite({ url: 'https://x.example/v?id=1', title: 'Some video' }, 2);
  await addFavourite(nsfs, { url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484 Title' }, 3);
  await updateBackup();
  assert.deepEqual(c.inFolder(), ['MD-273', 'Some video', 'NSFS-484 · NSFS-484 Title']);
  const before = (await getFavourites()).map((f) => [f.code, f.url, f.title]);

  // Removed and reinstalled: all extension storage is gone, the bookmarks aren't.
  c.wipe();
  await updateBackup();
  assert.equal(c.inFolder().length, 3);
  assert.equal(await restoreFromBackup(), true);
  assert.deepEqual((await getFavourites()).map((f) => [f.code, f.url, f.title]), before);
  assert.equal(await restoreFromBackup(), false); // only when there are none

  // Moved into the bookmarks bar: still the same backup.
  c.marks.find((m) => m.title === BACKUP_FOLDER)!.parentId = 'bar';
  await toggleFavourite(nsfs);
  await updateBackup();
  assert.equal(c.marks.filter((m) => m.title === BACKUP_FOLDER).length, 1);
  assert.deepEqual(c.inFolder(), ['MD-273', 'Some video']);
  assert.deepEqual(c.local, {}); // the un-star note is done with
  await updateBackup();
  assert.deepEqual(c.inFolder(), ['MD-273', 'Some video']);
});

test('a backup folder with the old name is found and renamed', async () => {
  const c = fakeChrome();
  const old = await chrome.bookmarks.create({ title: 'JAV Trailer Opener favourites' });
  await chrome.bookmarks.create({ parentId: old.id, title: 'NSFS-484', url: 'https://javtrailers.com/search/nsfs-484' });
  await updateBackup();
  assert.equal(c.marks.find((m) => m.id === old.id)!.title, BACKUP_FOLDER);
  assert.deepEqual(c.inFolder(), ['NSFS-484']);
  assert.equal(await restoreFromBackup(), true);
  assert.deepEqual((await getFavourites()).map((f) => f.code), [nsfs]);
});
