import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actressesFrom, addActress, getActresses, removeActress } from './actresses.ts';
import {
  ACTRESS_FOLDER,
  actressBookmark,
  BACKUP_FOLDER,
  fromActressBookmark,
  fromBookmark,
  planActressBackup,
  planBackup,
  planTagBackup,
  restoreFromBackup,
  restoreActressPatch,
  restorePatch,
  restoreTagPatch,
  TAG_FOLDER,
  toBookmark,
  updateBackup,
  type BackupNode,
} from './fav-backup.ts';
import { addFavourite, addPageFavourite, favouritesFrom, getFavourites, toggleFavourite } from './favourites.ts';
import { addTag, getTags, removeTag, removeTagPage, tagsFrom } from './tags.ts';

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

const actresses = actressesFrom({
  'actress:yua mikami': { name: 'Yua Mikami', added: 2, url: 'https://javtrailers.com/casts/yua-mikami' },
  'actress:三上悠亜': { name: '三上悠亜', added: 1 },
});

test('actresses as bookmarks and back', () => {
  assert.deepEqual(actresses.map(actressBookmark), [
    { title: 'Yua Mikami', url: 'https://javtrailers.com/casts/yua-mikami' },
    { title: '三上悠亜', url: 'https://javtrailers.com/search/%E4%B8%89%E4%B8%8A%E6%82%A0%E4%BA%9C' }, // no page saved
  ]);
  const back = actresses.map((a, i) => fromActressBookmark({ id: String(i), ...actressBookmark(a) }, a.added));
  assert.deepEqual(actressesFrom(Object.fromEntries(back.map((b) => [b!.key, b!.data]))), actresses);
  assert.equal(fromActressBookmark(node('1', 'A folder'), 5), null);
  assert.equal(fromActressBookmark(node('1', 'x', 'https://x.example/'), 5), null); // not a name
});

test('planActressBackup and restoreActressPatch work like the videos', () => {
  const nodes = [
    node('20', 'Yua Mikami', 'https://javtrailers.com/search/yua%20mikami', 100),
    node('21', 'yua  mikami', 'https://jable.tv/models/yua-mikami/', 200), // a second copy
    node('22', 'Ai Uehara', 'https://javtrailers.com/search/ai%20uehara', 150), // un-starred here
  ];
  const plan = planActressBackup(actresses, nodes, new Set(['actress:ai uehara']));
  assert.deepEqual(plan, { create: [{ title: '三上悠亜', url: 'https://javtrailers.com/search/%E4%B8%89%E4%B8%8A%E6%82%A0%E4%BA%9C' }], remove: ['22', '21'] });
  assert.deepEqual(restoreActressPatch(nodes), {
    'actress:yua mikami': { name: 'Yua Mikami', added: 100 },
    'actress:ai uehara': { name: 'Ai Uehara', added: 152 },
  });
});

const MISSAV_NTR = 'https://missav.ws/en/genres/NTR';
const JT_NTR = 'https://javtrailers.com/categories/ntr';
const tags = tagsFrom({
  'tag:ntr': { name: 'NTR', pages: [MISSAV_NTR, JT_NTR], added: 2 },
  'tag:affair': { name: 'Affair', pages: [], added: 1 },
});

test('planTagBackup: a bookmark per tag page, and what goes', () => {
  // Nothing backed up yet: oldest tag first, each tag's pages in order; a tag with no pages gets its search.
  assert.deepEqual(planTagBackup(tags, [], new Set()), {
    create: [
      { title: 'Affair', url: 'https://javtrailers.com/search/affair' },
      { title: 'NTR', url: MISSAV_NTR },
      { title: 'NTR', url: JT_NTR },
    ],
    remove: [],
  });
  const nodes = [
    node('30', 'NTR', 'https://javtrailers.com/search/ntr', 100), // its search: NTR has pages now
    node('31', 'NTR', MISSAV_NTR, 110),
    node('32', 'ntr', `${MISSAV_NTR}#x`, 120), // a second copy
    node('33', 'Cuckold', 'https://jav.guru/tag/cuckold/', 130), // whole tag un-starred here
    node('34', 'Affair', 'https://javtiful.com/category/affair', 140), // page taken off here
    node('35', 'Creampie', 'https://missav.ws/en/genres/Creampie', 150), // gone some other way: stays
  ];
  const unstarred = new Set(['tag:cuckold', 'tag:affair|https://javtiful.com/category/affair']);
  const plan = planTagBackup(tags, nodes, unstarred);
  assert.deepEqual(plan.remove, ['30', '32', '33', '34']);
  assert.deepEqual(plan.create, [
    { title: 'Affair', url: 'https://javtrailers.com/search/affair' },
    { title: 'NTR', url: JT_NTR },
  ]);
});

test('restoreTagPatch gathers each tag with its pages', () => {
  assert.deepEqual(
    restoreTagPatch([
      node('1', 'NTR', MISSAV_NTR, 50),
      node('2', 'Affair', 'https://javtrailers.com/search/affair', 60),
      node('3', 'ntr', JT_NTR, 70),
      node('4', 'A folder'),
    ]),
    {
      'tag:ntr': { name: 'NTR', pages: [MISSAV_NTR, JT_NTR], added: 50 },
      'tag:affair': { name: 'Affair', pages: [], added: 61 },
    },
  );
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
  const inFolder = (title = BACKUP_FOLDER) => {
    const folder = marks.find((m) => m.title === title && !m.url)!;
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

test('actresses are backed up in their own folder and come back on their own', async () => {
  const c = fakeChrome();
  await addFavourite(nsfs, null, 1);
  await addActress('Yua Mikami', 'https://javtrailers.com/casts/yua-mikami', 2);
  await addActress('三上悠亜', null, 3);
  await updateBackup();
  assert.deepEqual(c.inFolder(), ['NSFS-484', ACTRESS_FOLDER]);
  assert.deepEqual(c.inFolder(ACTRESS_FOLDER), ['Yua Mikami', '三上悠亜']);

  // Wiped: both come back.
  c.wipe();
  await updateBackup();
  assert.equal(await restoreFromBackup(), true);
  assert.deepEqual((await getFavourites()).map((f) => f.code), [nsfs]);
  assert.deepEqual(
    (await getActresses()).map((a) => [a.name, a.url ?? null]),
    [
      ['三上悠亜', null],
      ['Yua Mikami', 'https://javtrailers.com/casts/yua-mikami'],
    ],
  );

  // Removing one here removes her bookmark, and nothing else.
  await removeActress('Yua Mikami');
  await updateBackup();
  assert.deepEqual(c.inFolder(ACTRESS_FOLDER), ['三上悠亜']);
  assert.deepEqual(c.inFolder(), ['NSFS-484', ACTRESS_FOLDER]);
  assert.deepEqual(c.local, {});

  // Gone some other way (not removed here): she stays backed up, and comes back while the videos are there.
  delete c.sync['actress:三上悠亜'];
  await updateBackup();
  assert.equal(await restoreFromBackup(), true);
  assert.deepEqual((await getActresses()).map((a) => a.name), ['三上悠亜']);
});

test('tags are backed up in their own folder, a bookmark per page, and come back', async () => {
  const c = fakeChrome();
  await addTag('Affair', null, 1);
  await addTag('NTR', MISSAV_NTR, 2);
  await addTag('NTR', JT_NTR, 3);
  await updateBackup();
  assert.deepEqual(c.inFolder(), [TAG_FOLDER]);
  assert.deepEqual(c.inFolder(TAG_FOLDER), ['Affair', 'NTR', 'NTR']);

  c.wipe();
  await updateBackup();
  assert.equal(await restoreFromBackup(), true);
  assert.deepEqual(
    (await getTags()).map((t) => [t.name, t.pages]),
    [
      ['NTR', [MISSAV_NTR, JT_NTR]],
      ['Affair', []],
    ],
  );

  // A page taken off here, then a whole tag: their bookmarks go; Affair gets a page, so its search goes.
  await removeTagPage('NTR', MISSAV_NTR);
  await addTag('Affair', 'https://javtiful.com/category/affair');
  await updateBackup();
  assert.deepEqual(
    c.marks.filter((m) => m.url && c.inFolder(TAG_FOLDER).includes(m.title)).map((m) => m.url).sort(),
    ['https://javtiful.com/category/affair', JT_NTR],
  );
  await removeTag('NTR');
  await updateBackup();
  assert.deepEqual(c.inFolder(TAG_FOLDER), ['Affair']);
  assert.deepEqual(c.local, {});
});
