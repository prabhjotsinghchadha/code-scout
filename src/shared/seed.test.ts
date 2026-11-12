import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, builtInKeys, builtInsFrom, offeredByVersion, seed, type SeedState } from './seed.ts';
import { GROUPS, SITES, type Site } from './sites.ts';

const empty: SeedState = { quickLinks: [], linkGroups: [], openOnSites: [] };
const ALL = builtInKeys(BUILT_INS);

test('nothing to do when everything was offered', () => {
  assert.equal(seed(empty, ALL), null);
});

/** The keys of the built-ins that are only for a new install ("Start here"). */
const FOR_NEW = [
  ...BUILT_INS.groups.filter((g) => g.audience === 'new').map((g) => g.key),
  ...BUILT_INS.links.filter((l) => l.audience === 'new').flatMap((l) => [l.key, l.groupKey!]),
];

test('a new install gets the starting points, not the groups by taste', () => {
  const first = seed(empty, [], BUILT_INS, true)!;
  assert.equal(first.state.linkGroups[0], 'Start here');
  for (const group of ['Cheating', 'Cuckold', 'NTR']) assert.ok(!first.state.linkGroups.includes(group), group);
  const start = first.state.quickLinks.filter((l) => l.group === 'Start here').map((l) => l.name);
  assert.deepEqual(start, [
    'JavTrailers · New releases',
    'JavTrailers · Browse genres',
    'JavTrailers · Browse performers',
    'JavTrailers · Browse studios',
    'JavTrailers · Browse series',
    'JavTrailers · Release calendar',
  ]);
  assert.ok(!first.state.quickLinks.some((l) => /cheating|cuckold|adultery|affair/i.test(l.name)));
  assert.ok(first.state.quickLinks.some((l) => l.group === 'Subtitles'));
  assert.ok(first.state.openOnSites.length > 0);
  // Everything counts as offered: what wasn't for this install is never added to it later.
  assert.deepEqual(new Set(first.offered), new Set(ALL));
  assert.equal(seed(first.state, first.offered, BUILT_INS, false), null);
});

/** Added after v10, for every install: the Chinese group and its links. */
const SINCE_V10 = [
  'group:Chinese',
  ...['jable/chinese-subtitle', 'xchina/home', '91porn/home', 'rouvideo/home', 'avjiali/home'].flatMap((l) => [`link:${l}`, `link:${l}@Chinese`]),
];

test('an install from before the starting points keeps its lists: they are only noted as offered', () => {
  const state = { ...empty, quickLinks: [{ name: 'Mine', url: 'https://mine.example/' }], linkGroups: ['Mine'] };
  const result = seed(state, [...offeredByVersion(10), ...SINCE_V10])!;
  assert.deepEqual(result.state, state);
  assert.deepEqual(new Set(result.offered), new Set(ALL));
  for (const key of FOR_NEW) assert.ok(result.offered.includes(key), key);
});

test('an earlier install gets the Chinese group on its next update, after its own groups', () => {
  const state = { ...empty, linkGroups: ['Mine', 'More sites'] };
  const result = seed(state, [...offeredByVersion(10), ...FOR_NEW])!;
  assert.deepEqual(result.state.linkGroups, ['Mine', 'More sites', 'Chinese']);
  assert.deepEqual(
    result.state.quickLinks.map((l) => `${l.name} [${l.group}]`),
    ['Jable · Chinese subtitle', 'XChina', '91Porn · Home (English)', 'Rou Video', 'AV Jiali · Home (English)'].map((n) => `${n} [Chinese]`),
  );
  assert.deepEqual(result.state.openOnSites, []);
});

test('a site added to the registry is offered once, with its pages and "Open on" pattern', () => {
  const newSite: Site = {
    id: 'example',
    name: 'Example',
    origin: 'https://example.com',
    openOn: '/v/{code_lower}',
    pages: [{ id: 'new', label: 'New', path: '/new', group: 'More sites' }],
  };
  const builtIns = builtInsFrom([...SITES, newSite], GROUPS);
  const state = { ...empty, quickLinks: [{ name: 'Mine', url: 'https://mine.example/' }] };

  const first = seed(state, ALL, builtIns);
  assert.ok(first);
  assert.deepEqual(first.state.quickLinks, [
    { name: 'Mine', url: 'https://mine.example/' },
    { name: 'Example · New', url: 'https://example.com/new', group: 'More sites' },
  ]);
  assert.deepEqual(first.state.openOnSites, [{ id: 'example', name: 'Example', template: 'https://example.com/v/{code_lower}' }]);
  assert.deepEqual(first.state.linkGroups, []); // groups the user deleted stay deleted

  // Removed by the user afterwards: not offered again.
  assert.equal(seed(empty, first.offered, builtIns), null);
});

test('a page added to an existing site is offered on its own', () => {
  const sites = SITES.map((s) =>
    s.id === 'missav' ? { ...s, pages: [...s.pages!, { id: 'uncensored', label: 'Uncensored', path: '/dm/uncensored' }] } : s,
  );
  const result = seed(empty, ALL, builtInsFrom(sites, GROUPS));
  assert.deepEqual(result?.state.quickLinks, [{ name: 'MissAV · Uncensored', url: 'https://missav.ws/dm/uncensored' }]);
  assert.deepEqual(result?.state.openOnSites, []);
});

test('a link the user already has is not added twice, but goes into its new group once', () => {
  const url = 'https://missav.ws/dm23/en/english-subtitle';
  const offered = ALL.filter((k) => k !== 'link:missav/english-subtitle@Subtitles');
  const ungrouped = { ...empty, quickLinks: [{ name: 'Mine', url }] };
  assert.deepEqual(seed(ungrouped, offered)?.state.quickLinks, [{ name: 'Mine', url, group: 'Subtitles' }]);
  // Already grouped by the user: left in their group.
  const grouped = { ...empty, quickLinks: [{ name: 'Mine', url, group: 'NTR' }] };
  assert.deepEqual(seed(grouped, offered)?.state.quickLinks, [{ name: 'Mine', url, group: 'NTR' }]);
});

test('an "Open on" site the user already has (same id or pattern) is not added twice', () => {
  const offered = ALL.filter((k) => k !== 'site:missav' && k !== 'site:jable');
  const state = {
    ...empty,
    openOnSites: [
      { id: 'mine', name: 'My MissAV', template: 'https://missav.ws/en/{code_lower}' },
      { id: 'jable', name: 'Jable (edited)', template: 'https://jable.tv/s/{code}' },
    ],
  };
  assert.deepEqual(seed(state, offered)?.state.openOnSites, state.openOnSites);
});

test('old seed versions map to what they had offered', () => {
  assert.deepEqual(offeredByVersion(0), []);
  assert.ok(offeredByVersion(1).includes('link:javmost/cuckold'));
  assert.ok(!offeredByVersion(1).includes('link:javmost/cuckold@Cuckold'));
  assert.ok(offeredByVersion(6).includes('site:missav'));
  assert.ok(!offeredByVersion(9).includes('site:supjav'));
  // Everything since: the starting points (new installs only) and the Chinese group.
  assert.deepEqual(new Set([...offeredByVersion(10), ...FOR_NEW, ...SINCE_V10]), new Set(ALL));
});
