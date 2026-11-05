// Codes already seen (shared/seen.ts), for the ✓ on ▶ buttons and in the right-click menu. Loaded once and
// kept current; empty while "Remember codes you've seen" is off.
import { formatCode, type VideoCode } from '../shared/codes';
import { getSeen, onSeenChanged, type Seen, type SeenEntry } from '../shared/seen';

let seen: Seen = {};
let on = false;
let watching = false;
const listeners = new Set<() => void>();

export function seenEntryFor(code: VideoCode): SeenEntry | undefined {
  return on ? seen[formatCode(code)] : undefined;
}

/** Calls `callback` after the seen codes change (or the marks are turned on or off). */
export function onSeenChange(callback: () => void): void {
  listeners.add(callback);
}

/** Turns the marks on (loading the seen codes) or off. */
export async function setSeenMarks(enabled: boolean): Promise<void> {
  on = enabled;
  if (enabled) {
    if (!watching) {
      watching = true;
      onSeenChanged((next) => {
        seen = next;
        if (on) listeners.forEach((l) => l());
      });
    }
    seen = await getSeen();
  } else {
    seen = {};
  }
  listeners.forEach((l) => l());
}
