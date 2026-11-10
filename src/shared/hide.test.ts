import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWatchTab, watchSites } from './hide.ts';

const settings = {
  quickLinks: [{ name: 'Jable', url: 'https://www.jable.tv/categories/ntr/' }, { name: 'Bad', url: 'not a url' }],
  openOnSites: [{ id: 'missav', name: 'MissAV', template: 'https://m.missav.ws/en/{code_lower}' }],
  popupBlockSites: ['javtiful.com'],
};

test('collects the user\'s sites as base domains', () => {
  assert.deepEqual(watchSites(settings).sort(), ['jable.tv', 'javtiful.com', 'javtrailers.com', 'missav.ws']);
});

test('hides tabs on the user\'s sites, and their subdomains', () => {
  const sites = watchSites(settings);
  assert.equal(isWatchTab({ url: 'https://missav.ws/en/search/wife' }, sites), true);
  assert.equal(isWatchTab({ url: 'https://cdn.jable.tv/' }, sites), true);
  assert.equal(isWatchTab({ url: 'https://javtrailers.com/' }, sites), true);
  assert.equal(isWatchTab({ url: 'https://mail.google.com/mail/u/0/', title: 'Inbox (3)' }, sites), false);
});

test('hides tabs playing sound, and video pages on any site', () => {
  assert.equal(isWatchTab({ url: 'https://example.com/watch', audible: true }, []), true);
  assert.equal(isWatchTab({ url: 'https://example.com/videos/nsfs-484' }, []), true);
  assert.equal(isWatchTab({ url: 'https://example.com/v/91823', title: 'NSFS-484 English subtitles' }, []), true);
  assert.equal(isWatchTab({ url: 'https://example.com/search/nsfs-484', title: 'Search' }, []), false);
});

test('leaves pages that aren\'t web pages', () => {
  assert.equal(isWatchTab({ url: 'chrome://extensions/', audible: true }, []), false);
  assert.equal(isWatchTab({ title: 'NSFS-484' }, []), false);
});
