import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCENTS, isAccent, isTheme, onPageAccentVars } from './theme.ts';

test('known themes and accents only', () => {
  assert.ok(isTheme('system') && isTheme('light') && isTheme('dark'));
  assert.ok(!isTheme('sepia') && !isTheme(undefined));
  assert.ok(isAccent('rose') && isAccent('graphite'));
  assert.ok(!isAccent('toString') && !isAccent('pink') && !isAccent(3));
});

test('on-page variables: the accent picked, rose for anything else', () => {
  assert.equal(onPageAccentVars('blue')['--javtr-accent'], ACCENTS.blue.mark);
  assert.deepEqual(onPageAccentVars('nope'), onPageAccentVars('rose'));
  assert.equal(onPageAccentVars(undefined)['--javtr-ui'], '#e11d48');
});

test('every accent sets the same variables, as colours', () => {
  const names = Object.keys(onPageAccentVars('rose'));
  for (const accent of Object.keys(ACCENTS)) {
    const vars = onPageAccentVars(accent);
    assert.deepEqual(Object.keys(vars), names);
    for (const value of Object.values(vars)) assert.match(value, /^#[0-9a-f]{6}$/);
  }
});

test('graphite reads on the dark chip: light fill, dark text', () => {
  const vars = onPageAccentVars('graphite');
  assert.equal(vars['--javtr-ui'], '#e4e4e7');
  assert.equal(vars['--javtr-on-ui'], '#18181b');
});
