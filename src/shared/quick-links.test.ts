import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addGroup,
  deleteGroup,
  groupLinks,
  moveItem,
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
