import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoCode } from '../shared/codes.ts';
import type { DetailsCache, VideoDetails } from '../shared/details.ts';
import { facetsOf, facetText, matchesFacet } from './filter.ts';

const code = (prefix: string, number: number): VideoCode => ({ prefix, number });
const J = 'https://javtrailers.com';
const d = (cast: string[], studio?: string): VideoDetails => ({
  title: 't',
  cast: cast.map((name) => ({ name, url: `${J}/casts/${name.split(' ')[0].toLowerCase()}` })),
  genres: [],
  url: J,
  at: 0,
  ...(studio && { studio: { name: studio, url: `${J}/studios/${studio.toLowerCase()}` } }),
});
const codes = [code('sone', 1), code('sone', 2), code('jur', 3), code('abw', 4)];
const details: DetailsCache = {
  'SONE-001': d(['Hana Mori 森はな', 'Yui Sato'], 'S1'),
  'SONE-002': d(['Hana Mori'], 'S1'),
  'JUR-003': d(['Yui Sato', 'Yui Sato'], 'Madonna'),
  // ABW-004 hasn't been looked up.
};

test('what a list has most of: labels always, performers and studios where known', () => {
  const f = facetsOf(codes, details);
  assert.deepEqual(f.label.map((x) => [x.value, x.count]), [['SONE', 2], ['JUR', 1], ['ABW', 1]]);
  assert.deepEqual(f.performer.map((x) => [x.value, x.count]), [['Hana Mori', 2], ['Yui Sato', 2]]);
  assert.deepEqual(f.studio.map((x) => [x.value, x.count]), [['S1', 2], ['Madonna', 1]]);
  assert.equal(f.performer[0].url, `${J}/casts/hana`);
});

test('at most so many, and only what enough of them share', () => {
  assert.deepEqual(facetsOf(codes, details, 1).label.map((x) => x.value), ['SONE']);
  assert.deepEqual(facetsOf(codes, details, 6, 2).label.map((x) => x.value), ['SONE']);
  assert.deepEqual(facetsOf(codes, details, 6, 2).studio.map((x) => x.value), ['S1']);
  assert.deepEqual(facetsOf([], details).label, []);
});

test('narrowing: by label for any code, by performer or studio only for videos looked up', () => {
  const by = (kind: 'label' | 'performer' | 'studio', value: string) => codes.filter((c) => matchesFacet(c, { kind, value }, details)).map((c) => c.number);
  assert.deepEqual(by('label', 'SONE'), [1, 2]);
  assert.deepEqual(by('performer', 'Hana Mori'), [1, 2]);
  assert.deepEqual(by('performer', 'Yui Sato'), [1, 3]);
  assert.deepEqual(by('studio', 'Madonna'), [3]);
  assert.deepEqual(by('studio', 'Nobody'), []);
});

test('how a narrowed list says so', () => {
  assert.equal(facetText({ kind: 'label', value: 'SONE' }), 'SONE');
  assert.equal(facetText({ kind: 'performer', value: 'Hana Mori' }), 'with Hana Mori');
  assert.equal(facetText({ kind: 'studio', value: 'S1' }), 'from S1');
});
