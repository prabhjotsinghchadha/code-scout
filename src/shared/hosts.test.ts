import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDomain, isSiteOff, sameSite, siteKey, sitePatterns } from './hosts.ts';

test('turns URLs and hostnames into site keys', () => {
  assert.equal(siteKey('https://javtiful.com/video/114229/cawb-040-reducing-mosaic'), 'javtiful.com');
  assert.equal(siteKey('www.JavTiful.com'), 'javtiful.com');
  assert.equal(siteKey('javtiful.com'), 'javtiful.com');
  assert.equal(siteKey('m.javtiful.com/path'), 'm.javtiful.com');
  assert.equal(siteKey(''), null);
  assert.equal(siteKey('not a site'), null);
  assert.equal(siteKey('chrome://extensions'), null);
});

test('matches sites and their subdomains only', () => {
  const off = ['javtiful.com'];
  assert.equal(isSiteOff('javtiful.com', off), true);
  assert.equal(isSiteOff('www.javtiful.com', off), true);
  assert.equal(isSiteOff('m.javtiful.com', off), true);
  assert.equal(isSiteOff('notjavtiful.com', off), false);
  assert.equal(isSiteOff('missav.ws', off), false);
});

test('sameSite treats subdomains as the same site, ad networks as different', () => {
  assert.equal(baseDomain('m.javtiful.com'), 'javtiful.com');
  assert.ok(sameSite('https://javtiful.com/', 'https://www.javtiful.com/video/1'));
  assert.ok(!sameSite('https://javtiful.com/', 'https://superchatlive.com/girls'));
  assert.ok(!sameSite('not a url', 'https://javtiful.com/'));
});

test('sitePatterns covers subdomains, keeps localhost and IPs exact', () => {
  assert.deepEqual(sitePatterns(['javtiful.com', 'localhost', '127.0.0.1']), [
    '*://*.javtiful.com/*',
    '*://localhost/*',
    '*://127.0.0.1/*',
  ]);
});
