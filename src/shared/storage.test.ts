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

// --- seedQuickLinks against an in-memory chrome.storage ---
import { seedQuickLinks, type Settings } from './storage.ts';

function fakeChrome(sync: Record<string, unknown>, local: Record<string, unknown>) {
  const area = (data: Record<string, unknown>) => ({
    async get(keys: string | Record<string, unknown>) {
      if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
      return { ...keys, ...structuredClone(data) };
    },
    async set(patch: Record<string, unknown>) {
      Object.assign(data, structuredClone(patch));
    },
  });
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: area(sync), local: area(local) } };
  return { sync: sync as Partial<Settings>, local };
}

const names = (s: Partial<Settings>) => s.quickLinks!.map((l) => `${l.name}${l.group ? ` [${l.group}]` : ''}`);

test('seeds everything on a fresh install', async () => {
  const { sync, local } = fakeChrome({}, {});
  await seedQuickLinks();
  assert.deepEqual(sync.linkGroups, ['Cheating', 'Cuckold', 'NTR', 'All Japanese']);
  assert.deepEqual(names(sync), [
    'MissAV · English subtitle',
    'JavMost · Cuckold [Cuckold]',
    'Javtiful · Affair (popular) [Cheating]',
    'JavLibrary · Most wanted',
    'JavTrailers · Cheating Wife [Cheating]',
    'JavTrailers · Adultery [Cheating]',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
  ]);
  assert.equal(local.quickLinksSeedVersion, 6);
  assert.deepEqual(
    sync.openOnSites!.map((x) => x.name),
    ['MissAV', 'JavLibrary', 'JavMost', 'Javtiful', 'Jav Guru'],
  );
  await seedQuickLinks(); // idempotent
  assert.equal(sync.quickLinks!.length, 10);
});

test('upgrades a v1 install: groups existing built-ins, keeps removals and own links', async () => {
  const { sync } = fakeChrome(
    {
      quickLinks: [
        { name: 'My site', url: 'https://mine.example/' },
        { name: 'Renamed JavMost', url: 'https://www.javmost.ws/category/Cuckold/' },
        // user removed MissAV and Javtiful earlier
      ],
    },
    { quickLinksSeedVersion: 1 },
  );
  await seedQuickLinks();
  assert.deepEqual(names(sync), [
    'My site',
    'Renamed JavMost [Cuckold]',
    'JavLibrary · Most wanted',
    'JavTrailers · Cheating Wife [Cheating]',
    'JavTrailers · Adultery [Cheating]',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
  ]);
  assert.deepEqual(sync.linkGroups, ['Cheating', 'Cuckold', 'NTR', 'All Japanese']);
});

test('upgrades a v2 install: only adds links from v3 on', async () => {
  const { sync } = fakeChrome(
    { quickLinks: [{ name: 'X', url: 'https://x.example/', group: 'NTR' }], linkGroups: ['NTR', 'Cheating'] },
    { quickLinksSeedVersion: 2 },
  );
  await seedQuickLinks();
  assert.deepEqual(names(sync), [
    'X [NTR]',
    'JavLibrary · Most wanted',
    'JavTrailers · Cheating Wife [Cheating]',
    'JavTrailers · Adultery [Cheating]',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
  ]);
  assert.deepEqual(sync.linkGroups, ['NTR', 'Cheating', 'All Japanese']); // user's order kept, new group appended
});

test('upgrades a v3 install: adds Beeg and the All Japanese group', async () => {
  const { sync } = fakeChrome(
    { quickLinks: [{ name: 'X', url: 'https://x.example/' }], linkGroups: ['Cuckold'] },
    { quickLinksSeedVersion: 3 },
  );
  await seedQuickLinks();
  assert.deepEqual(names(sync), ['X', 'Beeg · Cuckold Japanese [Cuckold]', 
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
  ]);
  // A user who deleted NTR before v3 doesn't get it back.
  assert.deepEqual(sync.linkGroups, ['Cuckold', 'All Japanese']);
});

test('upgrades a v5 install: adds Open-on sites, keeps a site the user already added', async () => {
  const mine = { id: 'mine', name: 'My MissAV', template: 'https://missav.ws/en/{code_lower}' };
  const { sync } = fakeChrome({ quickLinks: [], linkGroups: [], openOnSites: [mine] }, { quickLinksSeedVersion: 5 });
  await seedQuickLinks();
  assert.deepEqual(
    sync.openOnSites!.map((x) => x.name),
    ['My MissAV', 'JavLibrary', 'JavMost', 'Javtiful', 'Jav Guru'],
  );
  assert.deepEqual(sync.quickLinks, []); // no quick links re-added
});
