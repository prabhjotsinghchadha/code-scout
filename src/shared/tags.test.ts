import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTag,
  getTags,
  looksLikeTagUrl,
  makeTag,
  removeTag,
  removeTagPage,
  tagFinder,
  tagKey,
  tagLinks,
  tagNameFromUrl,
  tagOfPageKey,
  tagPageKey,
  tagsFrom,
} from './tags.ts';

test('one tag however it is written', () => {
  for (const name of ['Cheating Wife', 'cheating-wife', 'CHEATING_WIFE', '  cheating   wife ']) {
    assert.equal(tagKey(name), 'tag:cheating wife', name);
  }
  assert.equal(tagKey('NTR'), 'tag:ntr');
  assert.equal(tagOfPageKey(tagPageKey('NTR', 'https://missav.ws/en/genres/NTR')), 'tag:ntr');
  assert.equal(tagOfPageKey('tag:ntr'), 'tag:ntr');
});

test('looksLikeTagUrl knows the usual tag pages', () => {
  for (const url of [
    'https://javtrailers.com/categories/cheating-wife',
    'https://missav.ws/en/genres/NTR',
    'https://javtiful.com/category/affair?sort=popular',
    'https://jav.guru/tag/cuckold/',
    'https://www.javmost.ws/category/Cuckold/',
    'https://www.javlibrary.com/en/vl_genre.php?g=ae',
  ]) {
    assert.equal(looksLikeTagUrl(url), true, url);
  }
  for (const url of ['https://missav.ws/en/nsfs-484', 'https://x.example/categories/', 'https://jav.guru/actress/rion/', 'nope']) {
    assert.equal(looksLikeTagUrl(url), false, url);
  }
});

test('tagNameFromUrl reads the tag from the address', () => {
  assert.equal(tagNameFromUrl('https://javtrailers.com/categories/cheating-wife'), 'Cheating Wife');
  assert.equal(tagNameFromUrl('https://missav.ws/en/genres/NTR'), 'NTR');
  assert.equal(tagNameFromUrl('https://www.javlibrary.com/en/vl_genre.php?g=ae'), null);
  assert.equal(tagNameFromUrl('https://x.example/tags/12345'), null);
});

test('makeTag keeps valid pages, each once, the newest 12', () => {
  assert.deepEqual(makeTag('NTR', ['https://a.example/tag/ntr#top', 'https://a.example/tag/ntr', 'javascript:x', `https://a.example/${'x'.repeat(600)}`], 5), {
    name: 'NTR',
    pages: ['https://a.example/tag/ntr'],
    added: 5,
  });
  const many = Array.from({ length: 15 }, (_, i) => `https://s${i}.example/tag/ntr`);
  const kept = makeTag('NTR', many, 1).pages;
  assert.equal(kept.length, 12);
  assert.equal(kept[0], 'https://s3.example/tag/ntr');
});

test('tagsFrom ignores other keys and bad entries, newest first', () => {
  const tags = tagsFrom({
    quickLinks: [],
    'actress:ntr': { name: 'NTR', added: 9 },
    'tag:ntr': { name: 'NTR', pages: ['https://missav.ws/en/genres/NTR', 7], added: 2 },
    'tag:affair': { name: 'Affair', added: 3 }, // no pages yet
    'tag:x': { name: 'x', pages: [], added: 4 },
    'tag:broken': 'broken',
  });
  assert.deepEqual(tags, [
    { name: 'Affair', pages: [], added: 3 },
    { name: 'NTR', pages: ['https://missav.ws/en/genres/NTR'], added: 2 },
  ]);
  assert.deepEqual(tagLinks(tags[0]), ['https://javtrailers.com/search/affair']);
  assert.deepEqual(tagLinks(tags[1]), ['https://missav.ws/en/genres/NTR']);
});

test('tagFinder knows a favourite tag by its saved page, its text or its address', () => {
  const find = tagFinder(
    tagsFrom({
      'tag:cheating wife': { name: 'Cheating Wife', pages: ['https://javtrailers.com/categories/cheating-wife'], added: 1 },
      'tag:ntr': { name: 'NTR', pages: [], added: 2 },
      'tag:affair': { name: 'Affair', pages: ['https://x.example/watch?list=affairs'], added: 3 },
    }),
  );
  assert.equal(find('https://javtrailers.com/categories/cheating-wife/', '人妻')?.name, 'Cheating Wife'); // saved page
  assert.equal(find('https://missav.ws/en/genres/NTR', 'NTR (2,341)')?.name, 'NTR'); // text
  assert.equal(find('https://jav.guru/tag/cheating-wife/', '')?.name, 'Cheating Wife'); // address
  assert.equal(find('https://x.example/watch?list=affairs#x', 'Watch')?.name, 'Affair'); // saved, not a tag link
  assert.equal(find('https://missav.ws/en/ntr-video-123', 'NTR'), undefined); // not a tag link
  assert.equal(find('https://missav.ws/en/genres/Creampie', 'Creampie'), undefined);
  assert.equal(tagFinder([])('https://missav.ws/en/genres/NTR', 'NTR'), undefined);
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

test('a tag gathers its pages from every site', async () => {
  const data: Record<string, unknown> = { quickLinks: [] };
  const local: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: fakeArea(data), local: fakeArea(local) } };

  assert.equal(await addTag('NTR (2,341)', 'https://missav.ws/en/genres/NTR', 10), 'added');
  assert.equal(await addTag('ntr', 'https://javtrailers.com/categories/ntr', 20), 'page-added');
  assert.equal(await addTag('NTR', 'https://missav.ws/en/genres/NTR#top', 30), 'exists');
  assert.equal(await addTag('Affair'), 'added');
  assert.equal(await addTag('Affair'), 'exists');
  assert.equal(await addTag('x'), 'invalid');
  assert.deepEqual(data['tag:ntr'], {
    name: 'NTR',
    pages: ['https://missav.ws/en/genres/NTR', 'https://javtrailers.com/categories/ntr'],
    added: 10,
  });

  await removeTagPage('NTR', 'https://missav.ws/en/genres/NTR');
  assert.deepEqual((data['tag:ntr'] as { pages: string[] }).pages, ['https://javtrailers.com/categories/ntr']);
  await removeTag('affair');
  assert.deepEqual((await getTags()).map((t) => t.name), ['NTR']);
  assert.deepEqual(Object.keys(local).sort(), ['unstarred:tag:affair', 'unstarred:tag:ntr|https://missav.ws/en/genres/NTR']);
});
