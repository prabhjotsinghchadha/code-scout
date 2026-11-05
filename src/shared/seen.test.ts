import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCode, parseCode, type VideoCode } from './codes.ts';
import { addSeen, forgetSeen, recentSeen, seenAgo, seenEntry, seenPage, videoPageCode, type Seen } from './seen.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const code = (text: string) => parseCode(text) as VideoCode;

test('addSeen notes when a code was seen, under its formatted code', () => {
  const seen = addSeen({}, code('nsfs00484'), 1000);
  assert.deepEqual(seen, { 'NSFS-484': { at: 1000 } });
  assert.deepEqual(seenEntry(seen, code('NSFS-484')), { at: 1000 });
  assert.equal(seenEntry(seen, code('NSFS-485')), undefined);
});

test('addSeen keeps the page it was visited on, tidied, and only web pages', () => {
  const page = { url: 'https://missav.ws/en/nsfs-484', title: '  NSFS-484   Some\n title ' };
  assert.deepEqual(addSeen({}, code('NSFS-484'), 1, page), {
    'NSFS-484': { at: 1, url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484 Some title' },
  });
  assert.deepEqual(addSeen({}, code('NSFS-484'), 1, { url: 'chrome://newtab/' }), { 'NSFS-484': { at: 1 } });
  assert.equal(addSeen({}, code('NSFS-484'), 1, { url: 'https://a.com/' + 'x'.repeat(3000) })['NSFS-484'].url, undefined);
  assert.equal(addSeen({}, code('NSFS-484'), 1, { url: 'https://a.com/', title: 'y'.repeat(300) })['NSFS-484'].title?.length, 100);
});

test('opening again from the extension updates the time but keeps the page', () => {
  let seen = addSeen({}, code('NSFS-484'), 1, { url: 'https://missav.ws/en/nsfs-484', title: 'Old' });
  seen = addSeen(seen, code('NSFS-484'), 2);
  assert.deepEqual(seen['NSFS-484'], { at: 2, url: 'https://missav.ws/en/nsfs-484', title: 'Old' });
  // A new page without a title doesn't keep the old page's title.
  seen = addSeen(seen, code('NSFS-484'), 3, { url: 'https://jable.tv/videos/nsfs-484/' });
  assert.deepEqual(seen['NSFS-484'], { at: 3, url: 'https://jable.tv/videos/nsfs-484/' });
});

test('addSeen forgets the codes seen longest ago past the limit', () => {
  let seen: Seen = {};
  for (let i = 1; i <= 5; i++) seen = addSeen(seen, { prefix: 'abp', number: i }, i * 10, null, 3);
  assert.deepEqual(Object.keys(seen).sort(), ['ABP-003', 'ABP-004', 'ABP-005']);
  // Seeing an old one again keeps it.
  seen = addSeen(seen, { prefix: 'abp', number: 3 }, 100, null, 3);
  seen = addSeen(seen, { prefix: 'abp', number: 6 }, 110, null, 3);
  assert.deepEqual(Object.keys(seen).sort(), ['ABP-003', 'ABP-005', 'ABP-006']);
});

test('recentSeen lists the most recent first, with codes that start with digits too', () => {
  let seen: Seen = {};
  seen = addSeen(seen, code('NSFS-484'), 10);
  seen = addSeen(seen, code('300MIUM-1001'), 30);
  seen = addSeen(seen, code('MD0273'), 20);
  seen['garbage'] = { at: 40 };
  assert.deepEqual(recentSeen(seen).map((s) => formatCode(s.code)), ['300MIUM-1001', 'MD-273', 'NSFS-484']);
  assert.deepEqual(recentSeen(seen, 1).map((s) => [formatCode(s.code), s.at]), [['300MIUM-1001', 30]]);
});

test('forgetSeen removes one code', () => {
  const seen = addSeen(addSeen({}, code('NSFS-484'), 1), code('ABP-001'), 2);
  assert.deepEqual(Object.keys(forgetSeen(seen, code('nsfs-484'))), ['ABP-001']);
});

test('seenAgo', () => {
  const now = 1000 * DAY;
  assert.equal(seenAgo(now - 20_000, now), 'just now');
  assert.equal(seenAgo(now - 5 * MIN, now), '5 min ago');
  assert.equal(seenAgo(now - 60 * MIN, now), '1 hour ago');
  assert.equal(seenAgo(now - 3 * 60 * MIN, now), '3 hours ago');
  assert.equal(seenAgo(now - 30 * 60 * MIN, now), 'yesterday');
  assert.equal(seenAgo(now - 4 * DAY, now), '4 days ago');
  assert.equal(seenAgo(now - 15 * DAY, now), '2 weeks ago');
  assert.equal(seenAgo(now - 90 * DAY, now), '3 months ago');
  assert.equal(seenAgo(now - 800 * DAY, now), '2 years ago');
  assert.equal(seenAgo(now + 5000, now), 'just now');
});

test('videoPageCode: an address that ends in a code, but not a search page', () => {
  const code = (url: string) => {
    const c = videoPageCode(url);
    return c && formatCode(c);
  };
  assert.equal(code('https://18jav.tv/videos/MD0273'), 'MD-273');
  assert.equal(code('https://missav.ws/en/nsfs-484'), 'NSFS-484');
  assert.equal(code('https://javtrailers.com/video/nsfs00484'), 'NSFS-484');
  assert.equal(code('https://javtrailers.com/video/1dldss00578'), 'DLDSS-578');
  assert.equal(code('https://javtrailers.com/search/nsfs-484'), null);
  assert.equal(code('https://missav.ws/en/search/NSFS-484'), null);
  assert.equal(code('https://missav.ws/en/new'), null);
  assert.equal(code('not a url'), null);
});

test('seenPage keeps the page, except on javtrailers.com', () => {
  assert.deepEqual(seenPage('https://missav.ws/en/nsfs-484', 'NSFS-484'), { url: 'https://missav.ws/en/nsfs-484', title: 'NSFS-484' });
  assert.equal(seenPage('https://javtrailers.com/video/nsfs00484', 'Trailer'), null);
  assert.equal(seenPage('https://www.javtrailers.com/video/nsfs00484'), null);
  assert.deepEqual(seenPage('https://notjavtrailers.com/x/nsfs-484'), { url: 'https://notjavtrailers.com/x/nsfs-484', title: undefined });
});
