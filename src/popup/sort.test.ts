import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoCode } from '../shared/codes.ts';
import { sortByName, sortByTime, sortLinks, sortPageCodes } from './sort.ts';

const code = (prefix: string, number: number): VideoCode => ({ prefix, number });
const names = (codes: VideoCode[]) => codes.map((c) => `${c.prefix}-${c.number}`);

test('page codes: page order, unseen first, A–Z', () => {
  const codes = [code('sone', 123), code('abw', 321), code('nsfs', 484), code('abw', 45)];
  const seen = (c: VideoCode) => c.prefix === 'sone' || c.number === 45;
  assert.equal(sortPageCodes(codes, 'order', seen), codes);
  assert.deepEqual(names(sortPageCodes(codes, 'unseen', seen)), ['abw-321', 'nsfs-484', 'sone-123', 'abw-45']);
  assert.deepEqual(names(sortPageCodes(codes, 'code', seen)), ['abw-45', 'abw-321', 'nsfs-484', 'sone-123']);
  assert.deepEqual(names(codes), ['sone-123', 'abw-321', 'nsfs-484', 'abw-45'], 'the list given is left as it was');
});

test('by time: newest, oldest, and A–Z with the ones without a code last', () => {
  const items = [
    { at: 3, code: code('sone', 123) },
    { at: 5, code: undefined },
    { at: 1, code: code('abw', 321) },
    { at: 9, code: undefined },
  ];
  const sorted = (by: 'newest' | 'oldest' | 'code') => sortByTime(items, by, (i) => i.at, (i) => i.code).map((i) => i.at);
  assert.deepEqual(sorted('newest'), [9, 5, 3, 1]);
  assert.deepEqual(sorted('oldest'), [1, 3, 5, 9]);
  assert.deepEqual(sorted('code'), [1, 3, 9, 5]);
});

test('by name: newest first, or A–Z whatever the case', () => {
  const items = [
    { name: 'yua Mikami', added: 1 },
    { name: 'Rei Kamiki', added: 3 },
    { name: 'Airi Kijima', added: 2 },
  ];
  assert.deepEqual(sortByName(items, 'newest').map((i) => i.added), [3, 2, 1]);
  assert.deepEqual(sortByName(items, 'az').map((i) => i.added), [2, 3, 1]);
});

test('links: my order, most visited, A–Z by the page’s name', () => {
  const links = [
    { name: 'MissAV · Subtitles', url: 'https://missav.ws/en/english-subtitle' },
    { name: 'Jable', url: 'https://jable.tv/' },
    { name: 'Jav Guru · Cheating', url: 'https://jav.guru/tag/cheating/' },
    { name: 'MissAV · Cuckold', url: 'https://missav.ws/en/genres/cuckold' },
  ];
  const now = 1_000_000;
  const visits = { 'jav.guru': { score: 9, at: now }, 'missav.ws': { score: 2, at: now } };
  const titles = (by: 'mine' | 'visited' | 'az') => sortLinks(links, by, visits, now).map((l) => l.name);
  assert.equal(sortLinks(links, 'mine', visits, now), links);
  assert.deepEqual(titles('visited'), ['Jav Guru · Cheating', 'MissAV · Subtitles', 'MissAV · Cuckold', 'Jable']);
  assert.deepEqual(titles('az'), ['Jav Guru · Cheating', 'MissAV · Cuckold', 'Jable', 'MissAV · Subtitles']);
});
