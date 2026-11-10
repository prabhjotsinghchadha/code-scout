import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewer, noticeFor, parseRelease } from './update.ts';

test('isNewer: compares dotted numbers, not text', () => {
  assert.equal(isNewer('0.2.0', '0.1.0'), true);
  assert.equal(isNewer('v0.10.0', '0.9.3'), true);
  assert.equal(isNewer('1.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.0.1', '0.1.0'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('0.1', '0.1.0'), false);
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
});

test('isNewer: a version it cannot read is never newer', () => {
  assert.equal(isNewer('latest', '0.1.0'), false);
  assert.equal(isNewer('1.0.0-beta', '0.1.0'), false);
  assert.equal(isNewer('', '0.1.0'), false);
  assert.equal(isNewer('1.0.0', 'dev'), false);
});

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/someone/code-scout/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  ...over,
});

test('parseRelease: the version without its "v", and the release page', () => {
  assert.deepEqual(parseRelease(release(), 'someone/code-scout'), {
    version: '0.2.0',
    url: 'https://github.com/someone/code-scout/releases/tag/v0.2.0',
  });
});

test('parseRelease: drafts, pre-releases, odd tags and links elsewhere are ignored', () => {
  const repo = 'someone/code-scout';
  assert.equal(parseRelease(release({ draft: true }), repo), null);
  assert.equal(parseRelease(release({ prerelease: true }), repo), null);
  assert.equal(parseRelease(release({ tag_name: 'nightly' }), repo), null);
  assert.equal(parseRelease(release({ html_url: 'https://example.com/releases/tag/v0.2.0' }), repo), null);
  assert.equal(parseRelease(release({ html_url: 'https://github.com/other/repo/releases/tag/v0.2.0' }), repo), null);
  assert.equal(parseRelease({ message: 'Not Found' }, repo), null);
  assert.equal(parseRelease(null, repo), null);
});

test('noticeFor: only a newer release the user has not closed', () => {
  const latest = { version: '0.2.0', url: 'https://github.com/someone/code-scout/releases/tag/v0.2.0' };
  assert.deepEqual(noticeFor({ checkedAt: 1, latest }, '0.1.0'), latest);
  assert.equal(noticeFor({ checkedAt: 1, latest }, '0.2.0'), null);
  assert.equal(noticeFor({ checkedAt: 1, latest, dismissed: '0.2.0' }, '0.1.0'), null);
  assert.deepEqual(noticeFor({ checkedAt: 1, latest, dismissed: '0.1.5' }, '0.1.0'), latest);
  assert.equal(noticeFor({ checkedAt: 1, latest: null }, '0.1.0'), null);
  assert.equal(noticeFor(undefined, '0.1.0'), null);
});
