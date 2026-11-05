import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCode, parseCode } from './codes.ts';
import {
  addFavourite,
  addPageFavourite,
  favKey,
  favouriteCodes,
  favouriteError,
  favouriteFor,
  favouritesFrom,
  FAVOURITES_FULL,
  getFavourites,
  isFavourite,
  makeFavourite,
  pageKey,
  toggleFavourite,
  togglePageFavourite,
} from './favourites.ts';

const nsfs = { prefix: 'nsfs', number: 484 };
const mium = { prefix: '300mium', number: 1234 };

test('keys are the formatted code and parse back', () => {
  assert.equal(favKey(nsfs), 'fav:NSFS-484');
  assert.equal(favKey(mium), 'fav:300MIUM-1234');
  for (const code of [nsfs, mium]) assert.deepEqual(parseCode(favKey(code).slice(4)), code);
});

test('makeFavourite keeps only http(s) pages and tidies titles', () => {
  assert.deepEqual(makeFavourite(null, 5), { added: 5 });
  assert.deepEqual(makeFavourite({ url: 'chrome://extensions/' }, 5), { added: 5 });
  assert.deepEqual(makeFavourite({ url: 'https://missav.ws/en/nsfs-484', title: '  NSFS-484 \n  Title  ' }, 5), {
    added: 5,
    url: 'https://missav.ws/en/nsfs-484',
    title: 'NSFS-484 Title',
  });
  assert.equal(makeFavourite({ url: 'https://x.example/', title: 'x'.repeat(300) }, 5).title!.length, 100);
  assert.deepEqual(makeFavourite({ url: 'https://x.example/', title: '   ' }, 5), { added: 5, url: 'https://x.example/' });
  assert.deepEqual(makeFavourite({ url: `https://x.example/${'a'.repeat(3000)}` }, 5), { added: 5 });
});

test('favouritesFrom ignores other keys and bad entries, newest first', () => {
  const favs = favouritesFrom({
    quickLinks: [],
    seededBuiltIns: ['x'],
    'fav:NSFS-484': { added: 1, url: 'https://missav.ws/en/nsfs-484', title: 'T' },
    'fav:300MIUM-1234': { added: 3 },
    'fav:IPX-001': { added: 2, url: 'javascript:alert(1)' },
    'fav:not a code': { added: 4 },
    'fav:SSIS-100': 'broken',
    'fav:ABP-123': { url: 'https://x.example/' }, // no timestamp
  });
  assert.deepEqual(
    favs.map((f) => [formatCode(f.code), f.url ?? null]),
    [
      ['300MIUM-1234', null],
      ['IPX-001', null],
      ['NSFS-484', 'https://missav.ws/en/nsfs-484'],
    ],
  );
});

test('quota errors say favourites are full', () => {
  assert.equal(favouriteError(new Error('QUOTA_BYTES quota exceeded')), FAVOURITES_FULL);
  assert.equal(favouriteError(new Error('MAX_ITEMS quota exceeded')), FAVOURITES_FULL);
  assert.notEqual(favouriteError(new Error('offline')), FAVOURITES_FULL);
});

function fakeArea(data: Record<string, unknown>) {
  return {
    async get(keys: string | null) {
      if (keys === null) return structuredClone(data);
      return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
    },
    async set(patch: Record<string, unknown>) {
      Object.assign(data, structuredClone(patch));
    },
    async remove(key: string) {
      delete data[key];
    },
  };
}

/** Sync storage (returned) and local storage (`unstarred`: the keys noted as un-starred there). */
function fakeSync() {
  const data: Record<string, unknown> = { quickLinks: [] };
  const local: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: fakeArea(data), local: fakeArea(local) } };
  unstarred = () => Object.keys(local).map((k) => k.replace('unstarred:', ''));
  return data;
}
let unstarred = (): string[] => [];

test('add, toggle and list against sync storage', async () => {
  const data = fakeSync();
  const page = { url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484' };
  assert.equal(await addFavourite(nsfs, page, 10), true);
  assert.equal(await addFavourite(nsfs, null, 20), false); // already there: kept as it was
  assert.deepEqual(data['fav:NSFS-484'], { added: 10, ...page });
  assert.equal(await toggleFavourite(mium), true);
  assert.equal(await isFavourite(mium), true);
  assert.deepEqual((await getFavourites()).map((f) => formatCode(f.code)), ['300MIUM-1234', 'NSFS-484']);
  assert.deepEqual(unstarred(), []);
  assert.equal(await toggleFavourite(nsfs), false);
  assert.equal('fav:NSFS-484' in data, false);
  assert.deepEqual(Object.keys(data).sort(), ['fav:300MIUM-1234', 'quickLinks']);
  assert.deepEqual(unstarred(), ['fav:NSFS-484']); // so its bookmark in the backup can go
});

test('page keys drop the #fragment and refuse non-web or overlong addresses', () => {
  assert.equal(pageKey('https://x.example/v?id=1#t=30'), 'favurl:https://x.example/v?id=1');
  assert.equal(pageKey('chrome://extensions/'), null);
  assert.equal(pageKey('not a url'), null);
  assert.equal(pageKey(`https://x.example/${'a'.repeat(3000)}`), null);
});

test('favouritesFrom lists starred pages next to codes', () => {
  const favs = favouritesFrom({
    'favurl:https://x.example/v?id=1': { added: 3, title: 'Some video' },
    'fav:NSFS-484': { added: 2 },
    'favurl:https://y.example/': { added: 1 },
    'favurl:javascript:alert(1)': { added: 4 },
    'favurl:not a url': { added: 5 },
    'favurl:https://z.example/': 'broken',
  });
  assert.deepEqual(favs, [
    { url: 'https://x.example/v?id=1', added: 3, title: 'Some video' },
    { code: nsfs, added: 2 },
    { url: 'https://y.example/', added: 1 },
  ]);
});

test('favouriteFor finds the code in the address, else the page', () => {
  const favs = favouritesFrom({
    'fav:MD-273': { added: 2, url: 'https://18jav.tv/videos/MD0273' },
    'favurl:https://x.example/v?id=1': { added: 1 },
  });
  assert.deepEqual(favouriteFor(favs, 'https://other.example/watch/md0273')?.code, { prefix: 'md', number: 273 });
  assert.equal(favouriteFor(favs, 'https://x.example/v?id=1#t=5')?.url, 'https://x.example/v?id=1');
  assert.equal(favouriteFor(favs, 'https://x.example/v?id=2'), undefined);
  assert.equal(favouriteFor(favs, 'chrome://newtab/'), undefined);
});

test('starring the page you are on', async () => {
  const data = fakeSync();
  const page = { url: 'https://x.example/v?id=1#t=30', title: '  Some   video ' };
  assert.equal(await addPageFavourite(page, 10), true);
  assert.equal(await addPageFavourite(page, 20), false); // already there
  assert.deepEqual(data['favurl:https://x.example/v?id=1'], { added: 10, title: 'Some video' });
  // An address with a code stars the code, with the page, so it gets Open, Search and Sites.
  const md = { url: 'https://18jav.tv/videos/MD0273', title: 'MD0273 Title' };
  assert.equal(await togglePageFavourite(md), true);
  assert.deepEqual(data['fav:MD-273'], { added: (data['fav:MD-273'] as { added: number }).added, ...md });
  assert.deepEqual([...(await favouriteCodes())], ['MD-273']); // pages aren't codes
  assert.equal((await getFavourites()).length, 2);
  assert.equal(await togglePageFavourite(md), false);
  assert.equal(await togglePageFavourite(page), false);
  assert.deepEqual(Object.keys(data), ['quickLinks']);
  assert.deepEqual(unstarred(), ['fav:MD-273', 'favurl:https://x.example/v?id=1']);
});
