import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, builtInKeys, builtInsFrom, offeredByVersion, seed, type SeedState } from './seed.ts';
import { GROUPS, SITES, type Site } from './sites.ts';

const empty: SeedState = { quickLinks: [], linkGroups: [], openOnSites: [] };
const ALL = builtInKeys(BUILT_INS);

test('nothing to do when everything was offered', () => {
  assert.equal(seed(empty, ALL), null);
  assert.equal(seed(empty, offeredByVersion(10)), null);
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
  assert.deepEqual(new Set(offeredByVersion(10)), new Set(ALL));
});
