import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, builtInKeys, builtInsFrom, LEGACY_KEYS, offeredByVersion } from './seed.ts';
import { GROUPS, SITES } from './sites.ts';
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

/**
 * In-memory chrome.storage. Like Chrome, get() returns only the keys asked for (stored values, else the
 * given defaults). Every set() is logged in `writes` as "area:key,key"; `failSync` makes sync writes throw.
 */
function fakeChrome(sync: Record<string, unknown>, local: Record<string, unknown>, { failSync = false } = {}) {
  const writes: string[] = [];
  const area = (name: string, data: Record<string, unknown>) => ({
    async get(keys: string | string[] | Record<string, unknown>) {
      const defaults: Record<string, unknown> =
        typeof keys === 'string' ? { [keys]: undefined } : Array.isArray(keys) ? Object.fromEntries(keys.map((k) => [k, undefined])) : keys;
      const out: Record<string, unknown> = {};
      for (const [k, d] of Object.entries(defaults)) {
        if (k in data) out[k] = structuredClone(data[k]);
        else if (d !== undefined) out[k] = d;
      }
      return out;
    },
    async set(patch: Record<string, unknown>) {
      if (name === 'sync' && failSync) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      writes.push(`${name}:${Object.keys(patch).sort().join(',')}`);
      Object.assign(data, structuredClone(patch));
    },
  });
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { sync: area('sync', sync), local: area('local', local) } };
  return { sync: sync as Partial<Settings> & { seededBuiltIns?: string[] }, local, writes };
}

/** Chrome's first sync on a device whose account has data: the account's copy replaces the local one. */
function serverMerge(sync: Record<string, unknown>, server: Record<string, unknown>) {
  for (const k of Object.keys(sync)) delete sync[k];
  Object.assign(sync, structuredClone(server));
}

const ALL = builtInKeys(BUILT_INS);
const SEED_WRITE = 'sync:linkGroups,openOnSites,quickLinks,seededBuiltIns';
/** What a user's synced lists might look like after some edits on their first device. */
const EDITED = {
  quickLinks: [
    { name: 'Mine', url: 'https://mine.example/' },
    { name: 'MissAV · English subtitle', url: 'https://missav.ws/dm23/en/english-subtitle' }, // ungrouped by the user
  ],
  linkGroups: ['Cheating', 'Mine'], // NTR and others deleted
  openOnSites: [{ id: 'missav', name: 'MissAV', template: 'https://missav.ws/en/{code_lower}' }],
};

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

test('seeds a fresh install with the starting points, writing only the seeded lists and the record', async () => {
  const { sync, local, writes } = fakeChrome({}, {});
  await seedBuiltIns();
  assert.deepEqual(Object.keys(sync).sort(), ['linkGroups', 'openOnSites', 'quickLinks', 'seededBuiltIns']);
  assert.deepEqual(writes, [SEED_WRITE, 'local:seededBuiltIns']);
  // A new install: "Start here", and none of the groups by taste (those were the first user's own).
  assert.deepEqual(sync.linkGroups, ['Start here', 'All Japanese', 'Subtitles', 'More sites']);
  assert.deepEqual(names(sync), [
    `MissAV · English subtitle ${SUBS}`,
    'JavLibrary · Most wanted',
    'JavTrailers · New releases [Start here]',
    'JavTrailers · Browse genres [Start here]',
    'JavTrailers · Browse performers [Start here]',
    'JavTrailers · Browse studios [Start here]',
    'JavTrailers · Browse series [Start here]',
    'JavTrailers · Release calendar [Start here]',
    'FapHouse · Japanese [All Japanese]',
    'Pornhub · Japanese [All Japanese]',
    'YouPorn · Japanese [All Japanese]',
    `Jav Guru · English subbed ${SUBS}`,
    `18JAV · Chinese subtitle ${SUBS}`,
    `Jable · Home (English) ${MORE}`,
    ...V10_LINKS,
  ]);
  assert.deepEqual(new Set(sync.seededBuiltIns), new Set(ALL));
  assert.deepEqual(new Set(local.seededBuiltIns as string[]), new Set(ALL));
  assert.deepEqual(sync.openOnSites!.map((x) => x.name), ALL_SITES);
  await seedBuiltIns(); // nothing new: no further writes
  assert.equal(sync.quickLinks!.length, 20);
  assert.equal(writes.length, 2);
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

test('upgrades a v10 install: lists untouched, record copied to sync once', async () => {
  const { sync, writes } = fakeChrome(structuredClone(EDITED), { quickLinksSeedVersion: 10 });
  await seedBuiltIns();
  const { seededBuiltIns, ...lists } = sync;
  assert.deepEqual(lists, EDITED);
  // The record also notes the starting points for new installs as offered: they're never added here.
  assert.deepEqual(new Set(seededBuiltIns), new Set(ALL));
  assert.deepEqual(writes, ['sync:seededBuiltIns', 'local:seededBuiltIns']);
  await seedBuiltIns();
  assert.equal(writes.length, 2);
});

test('a second device whose sync already has the lists and record writes nothing to sync', async () => {
  const { sync, writes } = fakeChrome({ ...structuredClone(EDITED), seededBuiltIns: ALL }, {});
  await seedBuiltIns();
  const { seededBuiltIns: _record, ...lists } = sync;
  assert.deepEqual(lists, EDITED); // deleted groups, built-ins and the user's grouping all kept
  assert.deepEqual(writes, ['local:seededBuiltIns']);
});

test('a second device before the first device updated: adopts the synced lists as they are', async () => {
  const { sync, writes } = fakeChrome(structuredClone(EDITED), {}); // lists from an older build, no record
  await seedBuiltIns();
  const { seededBuiltIns, ...lists } = sync;
  assert.deepEqual(lists, EDITED);
  assert.ok(LEGACY_KEYS.every((k) => seededBuiltIns!.includes(k)));
  assert.deepEqual(writes, ['sync:seededBuiltIns', 'local:seededBuiltIns']);
});

test('adopted lists still get built-ins added after the record moved to sync', async () => {
  const example = { id: 'example', name: 'Example', origin: 'https://example.com', openOn: '/v/{code}', pages: [{ id: 'home', path: '/' }] };
  const { sync } = fakeChrome(structuredClone(EDITED), {});
  await seedBuiltIns(builtInsFrom([...SITES, example], GROUPS));
  assert.deepEqual(sync.quickLinks, [...EDITED.quickLinks, { name: 'Example', url: 'https://example.com/' }]);
  assert.deepEqual(sync.openOnSites!.map((s) => s.id), ['missav', 'example']);
  assert.deepEqual(sync.linkGroups, EDITED.linkGroups);
});

test('a new profile seeded before its sync data arrived keeps the account data after the merge', async () => {
  const { sync, writes } = fakeChrome({}, {});
  await seedBuiltIns(); // seeded locally; sync hasn't started yet
  serverMerge(sync, EDITED); // first sync: the account's data (from an older build, no record) wins
  await seedBuiltIns(); // next update
  const { seededBuiltIns, ...lists } = sync;
  assert.deepEqual(lists, EDITED);
  assert.deepEqual(new Set(seededBuiltIns), new Set(ALL));
  assert.deepEqual(writes, [SEED_WRITE, 'local:seededBuiltIns', 'sync:seededBuiltIns']);
});

test('keeps record keys this build doesn\'t know (added by a newer build on another device)', async () => {
  const { sync, local } = fakeChrome({ seededBuiltIns: ['site:future'] }, { quickLinksSeedVersion: 9 });
  await seedBuiltIns();
  assert.ok(sync.seededBuiltIns!.includes('site:future'));
  assert.ok((local.seededBuiltIns as string[]).includes('site:future'));
});

test('a failed sync write records nothing, so the next update tries again', async () => {
  const { local } = fakeChrome({}, {}, { failSync: true });
  await assert.rejects(seedBuiltIns(), /quota/);
  assert.equal(local.seededBuiltIns, undefined);
});

test('built-ins removed after seeding stay removed on later updates', async () => {
  const { sync } = fakeChrome({}, {});
  await seedBuiltIns();
  sync.quickLinks = sync.quickLinks!.filter((l) => !l.name.startsWith('SexTB'));
  sync.openOnSites = sync.openOnSites!.filter((s) => s.id !== 'sextb');
  sync.linkGroups = sync.linkGroups!.filter((g) => g !== 'All Japanese');
  await seedBuiltIns();
  assert.equal(sync.quickLinks!.length, 19);
  assert.ok(!sync.openOnSites!.some((s) => s.id === 'sextb'));
  assert.ok(!sync.linkGroups!.includes('All Japanese'));
});
