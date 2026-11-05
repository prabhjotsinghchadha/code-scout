import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, builtInKeys } from './seed.ts';
import { defaultLinkName, normalizeUrl } from './storage.ts';

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

// --- seedBuiltIns against an in-memory chrome.storage ---
import { seedBuiltIns, type Settings } from './storage.ts';

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

const SUBS = '[Subtitles]';
const MORE = '[More sites]';
/** Links added from v10 on (they all come with a group). */
const V10_LINKS = [
  `SupJav · English subtitles ${SUBS}`,
  `BestJavPorn · English subtitle ${SUBS}`,
  `SexTB ${MORE}`,
  `7MMTV ${MORE}`,
  `Korean Porn Movie ${MORE}`,
  `ThePornDude · All sites ${MORE}`,
];
const ALL_GROUPS = ['Cheating', 'Cuckold', 'NTR', 'All Japanese', 'Subtitles', 'More sites'];
const ALL_SITES = ['MissAV', 'JavLibrary', 'JavMost', 'Javtiful', 'Jav Guru', 'Jable', 'SupJav', 'BestJavPorn', 'SexTB'];

test('seeds everything on a fresh install', async () => {
  const { sync, local } = fakeChrome({}, {});
  await seedBuiltIns();
  assert.deepEqual(sync.linkGroups, ALL_GROUPS);
  assert.deepEqual(names(sync), [
    `MissAV · English subtitle ${SUBS}`,
    'JavLibrary · Most wanted',
    'JavMost · Cuckold [Cuckold]',
    'Javtiful · Affair (popular) [Cheating]',
    'JavTrailers · Cheating Wife [Cheating]',
    'JavTrailers · Adultery [Cheating]',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
    `Jav Guru · English subbed ${SUBS}`,
    `18JAV · Chinese subtitle ${SUBS}`,
    `Jable · Home (English) ${MORE}`,
    ...V10_LINKS,
  ]);
  assert.deepEqual(new Set(local.seededBuiltIns as string[]), new Set(builtInKeys(BUILT_INS)));
  assert.deepEqual(sync.openOnSites!.map((x) => x.name), ALL_SITES);
  await seedBuiltIns(); // idempotent
  assert.equal(sync.quickLinks!.length, 19);
});

test('upgrades a v1 install: groups existing built-ins, keeps removals and own links', async () => {
  const { sync } = fakeChrome(
    {
      quickLinks: [
        { name: 'My site', url: 'https://mine.example/' },
        { name: 'Renamed JavMost', url: 'https://www.javmost.ws/category/Cuckold/' },
        { name: 'MissAV · English subtitle', url: 'https://missav.ws/dm23/en/english-subtitle' },
        // user removed Javtiful earlier
      ],
    },
    { quickLinksSeedVersion: 1 },
  );
  await seedBuiltIns();
  assert.deepEqual(names(sync), [
    'My site',
    'Renamed JavMost [Cuckold]',
    `MissAV · English subtitle ${SUBS}`,
    'JavLibrary · Most wanted',
    'JavTrailers · Cheating Wife [Cheating]',
    'JavTrailers · Adultery [Cheating]',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
    `Jav Guru · English subbed ${SUBS}`,
    `18JAV · Chinese subtitle ${SUBS}`,
    `Jable · Home (English) ${MORE}`,
    ...V10_LINKS,
  ]);
  assert.deepEqual(sync.linkGroups, ALL_GROUPS);
});

test('upgrades a v3 install: adds newer links and groups, keeps deleted groups deleted', async () => {
  const { sync } = fakeChrome(
    { quickLinks: [{ name: 'X', url: 'https://x.example/' }], linkGroups: ['Cuckold'] },
    { quickLinksSeedVersion: 3 },
  );
  await seedBuiltIns();
  assert.deepEqual(names(sync), [
    'X',
    'Beeg · Cuckold Japanese [Cuckold]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
    `Jav Guru · English subbed ${SUBS}`,
    `18JAV · Chinese subtitle ${SUBS}`,
    `Jable · Home (English) ${MORE}`,
    ...V10_LINKS,
  ]);
  // A user who deleted NTR before v3 doesn't get it back.
  assert.deepEqual(sync.linkGroups, ['Cuckold', 'All Japanese', 'Subtitles', 'More sites']);
});

test('upgrades a v5 install: adds Open-on sites, keeps a site the user already added', async () => {
  const mine = { id: 'mine', name: 'My MissAV', template: 'https://missav.ws/en/{code_lower}' };
  const { sync } = fakeChrome({ quickLinks: [], linkGroups: [], openOnSites: [mine] }, { quickLinksSeedVersion: 5 });
  await seedBuiltIns();
  assert.deepEqual(sync.openOnSites!.map((x) => x.name), ['My MissAV', ...ALL_SITES.slice(1)]);
});

test('upgrades a v9 install: groups ungrouped built-ins, leaves the user\'s grouping alone', async () => {
  const { sync } = fakeChrome(
    {
      quickLinks: [
        { name: 'MissAV · English subtitle', url: 'https://missav.ws/dm23/en/english-subtitle' },
        { name: 'Jav Guru', url: 'https://jav.guru/category/english-subbed/', group: 'NTR' }, // user's choice
        { name: 'Jable · Home (English)', url: 'https://jable.tv/?lang=en' },
        { name: 'JavLibrary · Most wanted', url: 'https://www.javlibrary.com/en/vl_mostwanted.php' },
      ],
      linkGroups: ['NTR'],
    },
    { quickLinksSeedVersion: 9 },
  );
  await seedBuiltIns();
  assert.deepEqual(names(sync), [
    `MissAV · English subtitle ${SUBS}`,
    'Jav Guru [NTR]',
    `Jable · Home (English) ${MORE}`,
    'JavLibrary · Most wanted',
    ...V10_LINKS,
  ]);
  assert.deepEqual(sync.linkGroups, ['NTR', 'Subtitles', 'More sites']);
  assert.deepEqual(sync.openOnSites!.map((x) => x.name), ['SupJav', 'BestJavPorn', 'SexTB']);
});

test('upgrades a v10 install: nothing new to offer, nothing written', async () => {
  const before = { quickLinks: [{ name: 'X', url: 'https://x.example/' }], linkGroups: ['NTR'], openOnSites: [] };
  const { sync, local } = fakeChrome(structuredClone(before), { quickLinksSeedVersion: 10 });
  await seedBuiltIns();
  assert.deepEqual(sync, before);
  assert.equal(local.seededBuiltIns, undefined);
});

test('built-ins removed after seeding stay removed on later updates', async () => {
  const { sync } = fakeChrome({}, {});
  await seedBuiltIns();
  sync.quickLinks = sync.quickLinks!.filter((l) => !l.name.startsWith('SexTB'));
  sync.openOnSites = sync.openOnSites!.filter((s) => s.id !== 'sextb');
  sync.linkGroups = sync.linkGroups!.filter((g) => g !== 'NTR');
  await seedBuiltIns();
  assert.equal(sync.quickLinks!.length, 18);
  assert.ok(!sync.openOnSites!.some((s) => s.id === 'sextb'));
  assert.ok(!sync.linkGroups!.includes('NTR'));
});
