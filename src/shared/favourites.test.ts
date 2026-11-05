import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCode, parseCode } from './codes.ts';
import {
  addFavourite,
  favKey,
  favouriteError,
  favouritesFrom,
  FAVOURITES_FULL,
  getFavourites,
  isFavourite,
  makeFavourite,
  toggleFavourite,
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

function fakeSync() {
  const data: Record<string, unknown> = { quickLinks: [] };
  const sync = {
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
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync } };
  return data;
}

test('add, toggle and list against sync storage', async () => {
  const data = fakeSync();
  const page = { url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484' };
  assert.equal(await addFavourite(nsfs, page, 10), true);
  assert.equal(await addFavourite(nsfs, null, 20), false); // already there: kept as it was
  assert.deepEqual(data['fav:NSFS-484'], { added: 10, ...page });
  assert.equal(await toggleFavourite(mium), true);
  assert.equal(await isFavourite(mium), true);
  assert.deepEqual((await getFavourites()).map((f) => formatCode(f.code)), ['300MIUM-1234', 'NSFS-484']);
  assert.equal(await toggleFavourite(nsfs), false);
  assert.equal('fav:NSFS-484' in data, false);
  assert.deepEqual(Object.keys(data).sort(), ['fav:300MIUM-1234', 'quickLinks']);
});
