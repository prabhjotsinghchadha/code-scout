import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParallelTuner } from './parallel-tuner.ts';

/**
 * Runs a tuner against a server whose speed (bytes/s) depends on the requests at once, one update a
 * second. Returns the tuner and each change it made, with the second it made it.
 */
function simulate(speedFor: (parallel: number) => number, seconds: number, tuner = new ParallelTuner(0)) {
  let bytes = 0;
  const changes: [number, number][] = [];
  for (let t = 1; t <= seconds; t++) {
    bytes += speedFor(tuner.limit);
    const changed = tuner.update(t * 1000, bytes);
    if (changed !== null) changes.push([t, changed]);
  }
  return { tuner, changes, limits: changes.map(([, limit]) => limit) };
}

const perRequest = (bytesPerSec: number, cap = Infinity) => (parallel: number) => bytesPerSec * Math.min(parallel, cap);

test('keeps adding requests while each one adds speed (a server that slows each request down)', () => {
  const { tuner, limits } = simulate(perRequest(50_000), 120);
  assert.deepEqual(limits, [12, 18, 24]);
  assert.equal(tuner.limit, 24);
});

test('goes back when more requests add nothing (HTTP/1.1: Chrome sends 6 at a time anyway)', () => {
  const { tuner, limits } = simulate(perRequest(50_000, 6), 60);
  assert.deepEqual(limits, [12, 6]);
  assert.equal(tuner.limit, 6);
});

test('tries again later, waiting longer each time it didn’t help', () => {
  const { tuner, changes } = simulate(() => 300_000, 30 * 60); // one speed shared by all requests
  assert.equal(tuner.limit, 6);
  const probes = changes.filter(([, limit]) => limit > 6).map(([t]) => t);
  assert.ok(probes.length >= 3 && probes.length <= 6, `probes at ${probes.join(', ')} s`);
  const gaps = probes.slice(1).map((t, i) => t - probes[i]);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1], `gaps ${gaps.join(', ')} s`);
});

test('keeps the last number that was worth it', () => {
  // Up to 14 requests help: 12 doubles the speed, 18 adds only a sixth.
  const { tuner, limits } = simulate(perRequest(50_000, 14), 90);
  assert.deepEqual(limits, [12, 18, 12]);
  assert.equal(tuner.limit, 12);
});

test('backs off a step when a request had to be retried, once per change', () => {
  const { tuner } = simulate(perRequest(50_000), 120);
  assert.equal(tuner.limit, 24);
  assert.equal(tuner.backOff(125_000), 18);
  assert.equal(tuner.backOff(125_500), null, 'the same burst of retries');
  assert.equal(tuner.limit, 18);
  assert.equal(new ParallelTuner(0).backOff(5000), null, 'never below the start');
});

test('a retry while trying more goes straight back to the number that worked', () => {
  const tuner = new ParallelTuner(0);
  const { limits } = simulate(perRequest(50_000), 13, tuner);
  assert.deepEqual(limits, [12]);
  assert.equal(tuner.backOff(17_000), 6);
});
