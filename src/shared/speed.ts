// Playback speed steps for the video toolbar's « 1.00 » and the < and > keys. Fine steps where they matter
// (around normal speed), bigger ones higher up, so the top is a few presses away, not sixty.

export const MIN_SPEED = 0.25;
/** Chrome plays nothing faster: a higher playbackRate is refused. */
export const MAX_SPEED = 16;

/** The step from `rate` going up, or down: 0.25 up to 2×, 0.5 up to 4×, 1 above. */
function stepAt(rate: number, direction: 1 | -1): number {
  const past = (limit: number) => (direction > 0 ? rate >= limit : rate > limit);
  return past(4) ? 1 : past(2) ? 0.5 : 0.25;
}

/** The speed one step slower or faster than `rate`, within what can be played. */
export function nextSpeed(rate: number, direction: 1 | -1): number {
  const next = Math.round((rate + direction * stepAt(rate, direction)) * 100) / 100;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, next));
}
