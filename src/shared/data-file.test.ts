import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataFileName,
  favouritesIn,
  importSummary,
  makeDataFile,
  mergeSeen,
  planImport,
  readDataFile,
  seenFrom,
  settingsFrom,
  type DataFile,
} from './data-file.ts';

const file = (sync: Record<string, unknown> = {}, local: Record<string, unknown> = {}): DataFile => ({
  app: 'code-scout',
  version: 1,
  exported: '2026-11-10T00:00:00.000Z',
  sync,
  local,
});

test('an export keeps what the extension stores, and nothing else', () => {
  const made = makeDataFile(
    {
      openMode: 'search',
      quickLinks: [{ name: 'MissAV', url: 'https://missav.ws/' }],
      seededBuiltIns: ['site:missav'],
      'fav:NSFS-484': { added: 1 },
      'favurl:https://a.com/v': { added: 2 },
      'actress:yua mikami': { name: 'Yua Mikami', added: 3 },
      'tag:ntr': { name: 'NTR', pages: [], added: 4 },
      somethingElse: 1,
    },
    {
      seenCodes: { 'NSFS-484': { at: 5 } },
      siteVisits: { 'missav.ws': { score: 2, at: 5 } },
      'cc:NSFS-484': { url: 'file:a.srt', offset: 0.5 },
      'unstarred:fav:ABC-101': 9,
      seededBuiltIns: ['site:missav'],
    },
    Date.UTC(2026, 10, 10),
  );
  assert.equal(made.app, 'code-scout');
  assert.equal(made.exported, '2026-11-10T00:00:00.000Z');
  assert.deepEqual(Object.keys(made.sync).sort(), [
    'actress:yua mikami', 'fav:NSFS-484', 'favurl:https://a.com/v', 'openMode', 'quickLinks', 'seededBuiltIns', 'tag:ntr',
  ]);
  assert.deepEqual(Object.keys(made.local).sort(), ['cc:NSFS-484', 'seenCodes', 'siteVisits']);
});

test('the file is named after the day it was made', () => {
  assert.equal(dataFileName(new Date(2026, 10, 9, 12).getTime()), 'code-scout-backup-2026-11-09.json');
});

test('reading a file: only a Code Scout backup of a known version', () => {
  assert.deepEqual(readDataFile('not json'), { error: 'That file isn’t a Code Scout backup (it isn’t JSON).' });
  assert.deepEqual(readDataFile('{"app":"other"}'), { error: 'That file isn’t a Code Scout backup.' });
  assert.deepEqual(readDataFile('[1]'), { error: 'That file isn’t a Code Scout backup.' });
  assert.match((readDataFile('{"app":"code-scout","version":2}') as { error: string }).error, /newer Code Scout/);
  assert.deepEqual(readDataFile('{"app":"code-scout","version":1,"sync":[],"local":{"a":1}}'), {
    app: 'code-scout',
    version: 1,
    exported: '',
    sync: {},
    local: { a: 1 },
  });
  const made = makeDataFile({ openMode: 'video' }, {}, 0);
  assert.deepEqual(readDataFile(JSON.stringify(made)), made);
});

test('settings are checked one by one', () => {
  assert.deepEqual(
    settingsFrom({
      inlineButtons: false,
      fieldChip: 'yes',
      openMode: 'elsewhere',
      subSize: 900,
      subBackground: 45.4,
      offSites: ['https://www.Javtiful.com/x', 'javtiful.com', 7, 'nonsense'],
      linkGroups: ['NTR', ' NTR ', '', 3],
      quickLinks: [
        { name: ' MissAV ', url: 'https://missav.ws/', group: 'Subtitles' },
        { name: '', url: 'https://a.com/' },
        { name: 'Bad', url: 'javascript:alert(1)' },
        'nope',
      ],
      openOnSites: [
        { id: 'a', name: 'A', template: 'https://a.com/{code}' },
        { id: 'a', name: 'Same id', template: 'https://b.com/{code}' },
        { id: 'c', name: 'No placeholder', template: 'https://c.com/' },
        { id: 'd', name: 'Not web', template: 'javascript:{code}' },
      ],
    }),
    {
      inlineButtons: false,
      subSize: 200,
      subBackground: 45,
      offSites: ['javtiful.com'],
      linkGroups: ['NTR'],
      quickLinks: [
        { name: 'MissAV', url: 'https://missav.ws/', group: 'Subtitles' },
        { name: 'https://a.com/', url: 'https://a.com/' },
      ],
      openOnSites: [{ id: 'a', name: 'A', template: 'https://a.com/{code}' }],
    },
  );
  assert.deepEqual(settingsFrom({ 'fav:NSFS-484': { added: 1 } }), {});
});

test('the look: a known theme and accent, or neither', () => {
  assert.deepEqual(settingsFrom({ theme: 'dark', accent: 'blue' }), { theme: 'dark', accent: 'blue' });
  assert.deepEqual(settingsFrom({ theme: 'sepia', accent: 'toString' }), {});
  assert.deepEqual(settingsFrom({ theme: 3, accent: null }), {});
});

test('favourites, actresses and tags are read as the extension stores them', () => {
  const found = favouritesIn({
    'fav:NSFS-484': { added: 1, url: 'https://missav.ws/en/nsfs-484', title: 'T', extra: 'x' },
    'fav:nsfs484': { added: 1 }, // not the key the extension would use
    'fav:ABC-101': { added: 'yesterday' },
    'fav:ABC-102': { added: 2, url: 'javascript:alert(1)' },
    'favurl:https://a.com/v': { added: 3, title: 'Page' },
    'actress:yua mikami': { name: 'Yua Mikami', url: 'https://missav.ws/actresses/Yua%20Mikami', added: 4 },
    'actress:someone': { name: 'Someone Else', added: 4 },
    'tag:ntr': { name: 'NTR', pages: ['https://missav.ws/genres/NTR', 'ftp://x/'], added: 5 },
    openMode: 'video',
  });
  assert.deepEqual(found.favourites, {
    'fav:NSFS-484': { added: 1, url: 'https://missav.ws/en/nsfs-484', title: 'T' },
    'fav:ABC-102': { added: 2 },
    'favurl:https://a.com/v': { added: 3, title: 'Page' },
  });
  assert.deepEqual(found.actresses, {
    'actress:yua mikami': { name: 'Yua Mikami', url: 'https://missav.ws/actresses/Yua%20Mikami', added: 4 },
  });
  assert.deepEqual(found.tags, { 'tag:ntr': { name: 'NTR', pages: ['https://missav.ws/genres/NTR'], added: 5 } });
});

test('seen codes are checked, and merged by when each was seen last', () => {
  assert.deepEqual(
    seenFrom({
      'NSFS-484': { at: 5, url: 'https://missav.ws/en/nsfs-484', title: 'T', more: 1 },
      'nsfs485': { at: 5 },
      'ABC-101': { at: '5' },
      'ABC-102': { at: 6, url: 'chrome://x', title: 'dropped with its page' },
      nonsense: { at: 1 },
    }),
    { 'NSFS-484': { at: 5, url: 'https://missav.ws/en/nsfs-484', title: 'T' }, 'ABC-102': { at: 6 } },
  );
  assert.deepEqual(seenFrom([1]), {});

  const here = { 'A-1': { at: 10 }, 'B-2': { at: 20, url: 'https://b.com/b-2' }, 'C-3': { at: 30 } };
  const there = { 'A-1': { at: 15, url: 'https://a.com/a-1' }, 'B-2': { at: 25 }, 'C-3': { at: 5, url: 'https://c.com/c-3' }, 'D-4': { at: 1 } };
  assert.deepEqual(mergeSeen(here, there), {
    'C-3': { at: 30, url: 'https://c.com/c-3' }, // seen later here; the page comes from the file
    'B-2': { at: 25, url: 'https://b.com/b-2' }, // opened later there; the page visited here is kept
    'A-1': { at: 15, url: 'https://a.com/a-1' },
    'D-4': { at: 1 },
  });
  assert.deepEqual(Object.keys(mergeSeen(here, there, 2)), ['C-3', 'B-2']);
});

test('an import replaces settings, adds favourites and merges what is kept on this computer', () => {
  const plan = planImport(
    file(
      {
        openMode: 'search',
        offSites: ['a.com'],
        'fav:NSFS-484': { added: 1 },
        'fav:ABC-101': { added: 2 },
        'actress:yua mikami': { name: 'Yua Mikami', added: 3 },
        'tag:ntr': { name: 'NTR', pages: [], added: 4 },
        junk: true,
      },
      {
        seenCodes: { 'NSFS-484': { at: 50 }, 'ABC-101': { at: 5 } },
        siteVisits: { 'missav.ws': { score: 3, at: 50 }, 'a.com': { score: 1, at: 1 }, 'Bad Site': { score: 1, at: 1 } },
        'cc:NSFS-484': { url: 'file:a.srt', offset: 1 },
        'cc:ABC-101': { url: 'file:b.srt', offset: 0 },
        'cc:XYZ-900': { url: 5 },
      },
    ),
    { openMode: 'video', offSites: ['b.com'], 'fav:NSFS-484': { added: 99, title: 'Mine' }, 'tag:ntr': { name: 'NTR', pages: ['https://x.com/tags/ntr'], added: 9 } },
    {
      seenCodes: { 'ABC-101': { at: 10 }, 'OLD-100': { at: 1 } },
      siteVisits: { 'a.com': { score: 4, at: 9 } },
      'cc:ABC-101': { url: 'file:mine.srt', offset: 2 },
    },
  );
  assert.deepEqual(plan.sync, {
    openMode: 'search',
    offSites: ['a.com'],
    'fav:ABC-101': { added: 2 },
    'actress:yua mikami': { name: 'Yua Mikami', added: 3 },
  });
  assert.deepEqual(plan.local, {
    seenCodes: { 'NSFS-484': { at: 50 }, 'ABC-101': { at: 10 }, 'OLD-100': { at: 1 } },
    siteVisits: { 'a.com': { score: 4, at: 9 }, 'missav.ws': { score: 3, at: 50 } },
    'cc:NSFS-484': { url: 'file:a.srt', offset: 1 },
  });
  assert.deepEqual(plan.counts, { settings: 2, favourites: 1, actresses: 1, tags: 0, alreadyHere: 2, seen: 1, subtitles: 1 });
});

test('quick links come with the record of built-ins they were offered', () => {
  const links = [{ name: 'MissAV', url: 'https://missav.ws/' }];
  const withLinks = planImport(file({ quickLinks: links, seededBuiltIns: ['site:missav', 'site:missav', 4] }), {}, {});
  assert.deepEqual(withLinks.sync, { quickLinks: links, seededBuiltIns: ['site:missav'] });
  assert.deepEqual(withLinks.local, { seededBuiltIns: ['site:missav'], quickLinksSeedVersion: 0 });
  // Without links in the file, this computer's record stays.
  assert.deepEqual(planImport(file({ seededBuiltIns: ['site:missav'] }), {}, {}), {
    sync: {},
    local: {},
    counts: { settings: 0, favourites: 0, actresses: 0, tags: 0, alreadyHere: 0, seen: 0, subtitles: 0 },
  });
});

test('an import that would overfill synced storage is refused', () => {
  const many = (prefix: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`fav:${prefix}-${i + 100}`, { added: i }]));
  assert.throws(() => planImport(file(many('NEW', 20)), many('OLD', 500), {}), /8 more favourites than fit/);
  assert.equal(planImport(file(many('NEW', 12)), many('OLD', 500), {}).counts.favourites, 12);
});

test('the summary says what was imported', () => {
  const none = { settings: 0, favourites: 0, actresses: 0, tags: 0, alreadyHere: 0, seen: 0, subtitles: 0 };
  assert.equal(importSummary(none), 'Nothing to import in that file.');
  assert.equal(importSummary({ ...none, alreadyHere: 3 }), 'Nothing new in that file. 3 favourites were here already.');
  assert.equal(importSummary({ ...none, settings: 9 }), 'Imported settings.');
  assert.equal(
    importSummary({ settings: 9, favourites: 12, actresses: 1, tags: 2, alreadyHere: 1, seen: 1240, subtitles: 1 }),
    'Imported settings, 12 favourites, 1 actress, 2 tags, 1,240 seen codes and 1 subtitle choice. 1 favourite was here already.',
  );
});
