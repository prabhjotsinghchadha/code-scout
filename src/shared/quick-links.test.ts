import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addGroup,
  appendLink,
  deleteGroup,
  groupLinks,
  linkLabel,
  moveItem,
  placeGroup,
  placeLink,
  renameGroup,
  setLinkGroup,
  validateGroupName,
  type LinkState,
} from './quick-links.ts';

const state: LinkState = {
  linkGroups: ['Cheating', 'Cuckold', 'NTR'],
  quickLinks: [
    { name: 'MissAV', url: 'https://a/' },
    { name: 'JavMost', url: 'https://b/', group: 'Cuckold' },
    { name: 'Javtiful', url: 'https://c/', group: 'Cheating' },
    { name: 'Orphan', url: 'https://d/', group: 'Gone' },
  ],
};

const summary = (s: LinkState) => groupLinks(s).map((x) => [x.group, x.links.map((l) => l.name)]);

test('groups links: ungrouped (incl. unknown groups) first, then groups in order', () => {
  assert.deepEqual(summary(state), [
    [null, ['MissAV', 'Orphan']],
    ['Cheating', ['Javtiful']],
    ['Cuckold', ['JavMost']],
    ['NTR', []],
  ]);
});

test('validates group names', () => {
  assert.equal(validateGroupName(state.linkGroups, 'Affair'), null);
  assert.match(validateGroupName(state.linkGroups, '  ')!, /Enter/);
  assert.equal(validateGroupName(state.linkGroups, 'ntr'), 'There’s already a group called “NTR”.');
  assert.match(validateGroupName(state.linkGroups, 'x'.repeat(31))!, /under/);
  // Renaming a group to a different case of its own name is fine.
  assert.equal(validateGroupName(state.linkGroups, 'cuckold', 'Cuckold'), null);
});

test('adds, renames and deletes groups', () => {
  assert.deepEqual(addGroup(state, ' Affair ').linkGroups, ['Cheating', 'Cuckold', 'NTR', 'Affair']);

  const renamed = renameGroup(state, 'Cheating', 'Affair');
  assert.deepEqual(renamed.linkGroups, ['Affair', 'Cuckold', 'NTR']);
  assert.equal(renamed.quickLinks[2].group, 'Affair');

  const deleted = deleteGroup(state, 'Cuckold');
  assert.deepEqual(deleted.linkGroups, ['Cheating', 'NTR']);
  assert.equal('group' in deleted.quickLinks[1], false);
  assert.equal(deleted.quickLinks.length, 4); // links are kept
});

test('moves items and sets a link group', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.equal(setLinkGroup(state.quickLinks, 'https://a/', 'NTR')[0].group, 'NTR');
  assert.equal('group' in setLinkGroup(state.quickLinks, 'https://b/', null)[1], false);
});

test('linkLabel: the page name after "Site · ", and the host', () => {
  assert.deepEqual(linkLabel({ name: 'MissAV · English subtitle', url: 'https://www.missav.ws/en/x' }), {
    title: 'English subtitle',
    host: 'missav.ws',
  });
  assert.deepEqual(linkLabel({ name: 'Jable', url: 'https://jable.tv/' }), { title: 'Jable', host: 'jable.tv' });
});

const names = (s: LinkState) => s.quickLinks.map((l) => `${l.name}:${l.group ?? '-'}`);

test('placeLink moves a link into another group, before a given link', () => {
  const next = placeLink(state, 'https://b/', 'Cheating', 'https://c/');
  assert.deepEqual(names(next), ['MissAV:-', 'JavMost:Cheating', 'Javtiful:Cheating', 'Orphan:Gone']);
});

test('placeLink with no "before" puts the link after its group’s last link', () => {
  const next = placeLink(state, 'https://a/', 'Cuckold', null);
  assert.deepEqual(names(next), ['JavMost:Cuckold', 'MissAV:Cuckold', 'Javtiful:Cheating', 'Orphan:Gone']);
  // To no group: after the last ungrouped link (an unknown group counts as none).
  const out = placeLink(state, 'https://c/', null, null);
  assert.deepEqual(names(out), ['MissAV:-', 'JavMost:Cuckold', 'Orphan:Gone', 'Javtiful:-']);
});

test('placeLink into an empty group appends at the end', () => {
  assert.deepEqual(names(placeLink(state, 'https://a/', 'NTR', null)).at(-1), 'MissAV:NTR');
});

test('appendLink adds at the end of its group', () => {
  const next = appendLink(state, { name: 'New', url: 'https://e/', group: 'Cheating' });
  assert.deepEqual(names(next), ['MissAV:-', 'JavMost:Cuckold', 'Javtiful:Cheating', 'New:Cheating', 'Orphan:Gone']);
});

test('placeGroup reorders groups', () => {
  assert.deepEqual(placeGroup(['A', 'B', 'C'], 'C', 'A'), ['C', 'A', 'B']);
  assert.deepEqual(placeGroup(['A', 'B', 'C'], 'A', null), ['B', 'C', 'A']);
  assert.deepEqual(placeGroup(['A', 'B', 'C'], 'B', 'B'), ['A', 'B', 'C']);
});
