import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWatchUrl, wipeSites } from './wipe.ts';

const settings = {
  quickLinks: [{ name: 'Jable', url: 'https://www.jable.tv/categories/ntr/' }],
  openOnSites: [{ id: 'missav', name: 'MissAV', template: 'https://m.missav.ws/en/{code_lower}' }],
  popupBlockSites: [],
};

test('the user\'s sites, and the sites their seen codes were watched on', () => {
  const seen = { 'NSFS-484': { at: 1, url: 'https://www.supjav.com/123.html' }, 'IPZZ-077': { at: 2 } };
  assert.deepEqual(wipeSites(settings, seen).sort(), ['jable.tv', 'javtrailers.com', 'missav.ws', 'supjav.com']);
});

test('matches pages on those sites and video pages anywhere, nothing else', () => {
  const sites = wipeSites(settings);
  assert.equal(isWatchUrl('https://cdn.jable.tv/x', sites), true);
  assert.equal(isWatchUrl('https://example.com/videos/nsfs-484', sites), true);
  assert.equal(isWatchUrl('https://mail.google.com/mail/u/0/', sites), false);
  assert.equal(isWatchUrl('https://notjable.tv.example.com/', sites), false);
  assert.equal(isWatchUrl('chrome://history/', sites), false);
  assert.equal(isWatchUrl(undefined, sites), false);
});
