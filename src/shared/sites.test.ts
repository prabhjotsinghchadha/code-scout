import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate } from './open-on.ts';
import { BUILT_INS, builtInKeys, LEGACY_KEYS } from './seed.ts';
import { GROUPS, SITES } from './sites.ts';

const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

test('site and page ids are unique', () => {
  assert.deepEqual(dupes(SITES.map((s) => s.id)), []);
  for (const site of SITES) assert.deepEqual(dupes((site.pages ?? []).map((p) => p.id)), [], site.id);
  assert.deepEqual(dupes(GROUPS), []);
});

test('origins are scheme + host, paths start with /', () => {
  for (const site of SITES) {
    assert.equal(new URL(site.origin).origin, site.origin, site.id);
    for (const page of site.pages ?? []) assert.ok(page.path.startsWith('/'), `${site.id}/${page.id}`);
    if (site.openOn) assert.ok(site.openOn.startsWith('/'), site.id);
  }
});

test('every page group is a built-in group', () => {
  for (const site of SITES) {
    for (const page of site.pages ?? []) if (page.group) assert.ok(GROUPS.includes(page.group), `${site.id}/${page.id}`);
  }
});

test('built-in links are distinct, normalized URLs', () => {
  const urls = BUILT_INS.links.map((l) => l.url);
  assert.deepEqual(dupes(urls), []);
  for (const url of urls) assert.equal(new URL(url).href, url);
});

test('built-in "Open on" patterns are valid', () => {
  for (const site of BUILT_INS.sites) assert.equal(validateTemplate(site.template), null, site.id);
});

test('built-ins keep the URLs older versions shipped', () => {
  const link = (key: string) => BUILT_INS.links.find((l) => l.key === key);
  assert.equal(link('link:missav/english-subtitle')?.url, 'https://missav.ws/dm23/en/english-subtitle');
  assert.equal(link('link:beeg/cuckold-japanese')?.url, 'https://beeg.com/Cuckold+Japanese');
  assert.equal(link('link:jable/home')?.url, 'https://jable.tv/?lang=en');
  assert.equal(link('link:sextb/home')?.name, 'SexTB');
  const site = (id: string) => BUILT_INS.sites.find((s) => s.id === id)?.template;
  assert.equal(site('missav'), 'https://missav.ws/en/{code_lower}');
  assert.equal(site('javlibrary'), 'https://www.javlibrary.com/en/vl_searchbyid.php?keyword={code}');
});

test('every key in the old-version table still exists in the registry', () => {
  const keys = new Set(builtInKeys(BUILT_INS));
  assert.deepEqual(LEGACY_KEYS.filter((k) => !keys.has(k)), []);
  assert.deepEqual(dupes(LEGACY_KEYS), []);
});
