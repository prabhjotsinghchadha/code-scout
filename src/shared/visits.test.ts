import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVisit, mostVisitedLinks, scoreNow, siteOf, type Visits } from './visits.ts';

const DAY = 24 * 60 * 60 * 1000;

test('siteOf groups subdomains under one site', () => {
  assert.equal(siteOf('https://www.missav.ws/en/x'), 'missav.ws');
  assert.equal(siteOf('https://m.jav.guru/'), 'jav.guru');
  assert.equal(siteOf('chrome://newtab/'), null);
});

test('a visit counts less as time passes (half after two weeks)', () => {
  const v = addVisit({}, 'jav.guru', 0);
  assert.equal(scoreNow(v['jav.guru'], 0), 1);
  assert.ok(Math.abs(scoreNow(v['jav.guru'], 14 * DAY) - 0.5) < 1e-9);
});

test('addVisit adds up and forgets sites not visited for months', () => {
  let v: Visits = addVisit({}, 'old.com', 0);
  v = addVisit(v, 'jav.guru', 100 * DAY);
  v = addVisit(v, 'jav.guru', 100 * DAY);
  assert.deepEqual(Object.keys(v), ['jav.guru']);
  assert.equal(v['jav.guru'].score, 2);
});

test('mostVisitedLinks: one link per site, most visited first, only visited sites', () => {
  const links = [
    { name: 'MissAV · Subs', url: 'https://missav.ws/subs' },
    { name: 'FapHouse', url: 'https://faphouse.com/' },
    { name: 'MissAV · New', url: 'https://missav.ws/new' },
    { name: 'Jable', url: 'https://jable.tv/' },
  ];
  let v: Visits = {};
  for (let i = 0; i < 3; i++) v = addVisit(v, 'faphouse.com', 0);
  v = addVisit(v, 'missav.ws', 0);
  assert.deepEqual(
    mostVisitedLinks(links, v, 0).map((l) => l.name),
    ['FapHouse', 'MissAV · Subs'],
  );
  assert.deepEqual(mostVisitedLinks(links, v, 0, 1).map((l) => l.name), ['FapHouse']);
});
