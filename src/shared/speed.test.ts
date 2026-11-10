import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SPEED, MIN_SPEED, nextSpeed } from './speed.ts';

const climb = (from: number, direction: 1 | -1, times: number) => {
  const out: number[] = [];
  for (let rate = from, i = 0; i < times; i++) out.push((rate = nextSpeed(rate, direction)));
  return out;
};

test('faster: quarter steps to 2, halves to 4, whole steps to 16', () => {
  assert.deepEqual(climb(1, 1, 4), [1.25, 1.5, 1.75, 2]);
  assert.deepEqual(climb(2, 1, 4), [2.5, 3, 3.5, 4]);
  assert.deepEqual(climb(4, 1, 3), [5, 6, 7]);
  assert.deepEqual(climb(15, 1, 2), [16, 16]);
});

test('slower comes back down the same steps', () => {
  assert.deepEqual(climb(6, -1, 2), [5, 4]);
  assert.deepEqual(climb(4, -1, 4), [3.5, 3, 2.5, 2]);
  assert.deepEqual(climb(2, -1, 2), [1.75, 1.5]);
  assert.deepEqual(climb(0.5, -1, 2), [0.25, 0.25]);
});

test('from a speed the site set, off the steps, it still moves and stays in range', () => {
  assert.equal(nextSpeed(1.3, 1), 1.55);
  assert.equal(nextSpeed(4.2, -1), 3.2);
  assert.equal(nextSpeed(40, 1), MAX_SPEED);
  assert.equal(nextSpeed(0.1, -1), MIN_SPEED);
});
