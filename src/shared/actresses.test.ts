import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actressesFrom,
  actressKey,
  actressLink,
  actressMatcher,
  addActress,
  capitalized,
  cleanName,
  getActresses,
  isFavouriteActress,
  looksLikeActressUrl,
  nameFromUrl,
  removeActress,
  toggleActress,
} from './actresses.ts';

test('keys ignore case and spacing', () => {
  assert.equal(actressKey('Yua Mikami'), 'actress:yua mikami');
  assert.equal(actressKey('  yua   MIKAMI '), 'actress:yua mikami');
  assert.equal(actressKey('三上悠亜'), 'actress:三上悠亜');
});

test('cleanName tidies link text and refuses what is not a name', () => {
  assert.equal(cleanName('  Yua \n Mikami  '), 'Yua Mikami');
  assert.equal(cleanName('Yua Mikami (152)'), 'Yua Mikami');
  assert.equal(cleanName('Yua Mikami 152 videos'), 'Yua Mikami');
  assert.equal(cleanName('#Yua Mikami'), 'Yua Mikami');
  assert.equal(cleanName('三上悠亜【120】'), '三上悠亜');
  assert.equal(cleanName('Ｙｕａ Ｍｉｋａｍｉ'), 'Yua Mikami'); // full-width letters
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('12345'), null);
  assert.equal(cleanName('x'.repeat(61)), null);
  assert.equal(cleanName(''), null);
});

test('capitalized only fixes names typed all in lower case', () => {
  assert.equal(capitalized('ai uehara'), 'Ai Uehara');
  assert.equal(capitalized('Rion'), 'Rion');
  assert.equal(capitalized('JULIA'), 'JULIA');
  assert.equal(capitalized('mikami YUA'), 'mikami YUA');
  assert.equal(capitalized('三上悠亜'), '三上悠亜');
});

test('looksLikeActressUrl knows the usual actress pages', () => {
  for (const url of [
    'https://missav.ws/en/actresses/Yua%20Mikami',
    'https://javtrailers.com/casts/yua-mikami',
    'https://jable.tv/models/yua-mikami/',
    'https://jav.guru/actress/yua-mikami/',
    'https://www.javmost.ws/star/Yua%20Mikami/',
    'https://www.pornhub.com/pornstar/yua-mikami',
    'https://www.javlibrary.com/en/vl_star.php?s=ae5q',
  ]) {
    assert.equal(looksLikeActressUrl(url), true, url);
  }
  for (const url of ['https://missav.ws/en/nsfs-484', 'https://x.example/start', 'https://x.example/actresses/', 'not a url']) {
    assert.equal(looksLikeActressUrl(url), false, url);
  }
});

test('nameFromUrl reads a name from the address, not an id', () => {
  assert.equal(nameFromUrl('https://javtrailers.com/casts/yua-mikami'), 'Yua Mikami');
  assert.equal(nameFromUrl('https://missav.ws/en/actresses/Yua%20Mikami'), 'Yua Mikami');
  assert.equal(nameFromUrl('https://jav.guru/actress/yua-mikami/'), 'Yua Mikami');
  assert.equal(nameFromUrl('https://missav.ws/en/actresses/%E4%B8%89%E4%B8%8A%E6%82%A0%E4%BA%9C'), '三上悠亜');
  assert.equal(nameFromUrl('https://javdb.com/actors/12345'), null);
  assert.equal(nameFromUrl('https://www.javlibrary.com/en/vl_star.php?s=ae5q'), null);
  assert.equal(nameFromUrl('https://x.example/videos/abc'), null);
});

test('actressesFrom ignores other keys and bad entries, newest first', () => {
  const list = actressesFrom({
    quickLinks: [],
    'fav:NSFS-484': { added: 9 },
    'actress:yua mikami': { name: 'Yua Mikami', added: 1, url: 'https://javtrailers.com/casts/yua-mikami' },
    'actress:三上悠亜': { name: '三上悠亜', added: 3 },
    'actress:bad url': { name: 'Bad Url', added: 2, url: 'javascript:alert(1)' },
    'actress:no time': { name: 'No Time' },
    'actress:no name': { added: 4 },
    'actress:broken': 'broken',
  });
  assert.deepEqual(list, [
    { name: '三上悠亜', added: 3 },
    { name: 'Bad Url', added: 2 },
    { name: 'Yua Mikami', added: 1, url: 'https://javtrailers.com/casts/yua-mikami' },
  ]);
});

test('actressLink opens her page, else a search for her name', () => {
  assert.equal(actressLink({ name: 'Yua Mikami', added: 1, url: 'https://jable.tv/models/yua-mikami/' }), 'https://jable.tv/models/yua-mikami/');
  assert.equal(actressLink({ name: 'Yua Mikami', added: 1 }), 'https://javtrailers.com/search/yua%20mikami');
});

test('actressMatcher finds names in text', () => {
  const find = actressMatcher(['Yua Mikami', 'Ai', '三上悠亜', 'Yua']);
  assert.deepEqual(find('New release starring yua  mikami!'), ['Yua Mikami']);
  assert.deepEqual(find('MIKAMI YUA debut'), ['Yua Mikami']); // the other way round
  assert.deepEqual(find('Paid in full'), []); // "Ai" only as a word
  assert.deepEqual(find('Ai and Yua'), ['Ai', 'Yua']);
  assert.deepEqual(find('新作 三上悠亜 出演'), ['三上悠亜']);
  assert.deepEqual(find('三上悠亜の新作'), ['三上悠亜']); // no spaces in Japanese
  assert.deepEqual(find('Yua Mikami and Yua Mikami'), ['Yua Mikami']);
  assert.deepEqual(actressMatcher([])('Yua Mikami'), []);
  assert.deepEqual(actressMatcher(['A.I. (Star)'])('so A.I. (Star) it is'), ['A.I. (Star)']); // regex characters
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

test('add, toggle and remove against sync storage', async () => {
  const data: Record<string, unknown> = { quickLinks: [] };
  const local: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: fakeArea(data), local: fakeArea(local) } };

  const page = 'https://javtrailers.com/casts/yua-mikami';
  assert.equal(await addActress(' Yua  Mikami (152)', page, 10), true);
  assert.equal(await addActress('yua mikami', null, 20), false); // already there: kept as it was
  assert.deepEqual(data['actress:yua mikami'], { name: 'Yua Mikami', added: 10, url: page });
  assert.equal(await addActress('x', null), false); // not a name
  assert.equal(await toggleActress('三上悠亜'), true);
  assert.equal(await isFavouriteActress('三上悠亜'), true);
  assert.deepEqual((await getActresses()).map((a) => a.name).sort(), ['Yua Mikami', '三上悠亜']);
  assert.deepEqual(Object.keys(local), []);
  assert.equal(await toggleActress('YUA MIKAMI'), false);
  await removeActress('三上悠亜');
  assert.deepEqual(Object.keys(data), ['quickLinks']);
  assert.deepEqual(Object.keys(local).sort(), ['unstarred:actress:yua mikami', 'unstarred:actress:三上悠亜']);
});
