import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_QUICK_LINKS, defaultLinkName, normalizeUrl } from './storage.ts';

test('normalizes quick-link URLs', () => {
  assert.equal(
    normalizeUrl('https://javtiful.com/category/affair?sort=popular'),
    'https://javtiful.com/category/affair?sort=popular',
  );
  assert.equal(normalizeUrl('www.javmost.ws/category/Cuckold/'), 'https://www.javmost.ws/category/Cuckold/');
  assert.equal(normalizeUrl('  '), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('not a url'), null);
});

test('builds readable default link names', () => {
  assert.equal(defaultLinkName('https://www.javmost.ws/category/Cuckold/'), 'javmost.ws › Cuckold');
  assert.equal(defaultLinkName('https://javtiful.com/category/affair?sort=popular'), 'javtiful.com › affair');
  assert.equal(defaultLinkName('https://example.com/'), 'example.com');
});

test('built-in quick links are valid, normalized URLs', () => {
  for (const { url } of BUILT_IN_QUICK_LINKS) assert.equal(normalizeUrl(url), url);
});
