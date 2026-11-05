// How many requests at once download a video fastest. Some video servers slow each request down but let
// many run side by side (18JAV's CDN: about 50 KB/s each), so more at once is faster. Others share one
// speed between all of them, or speak HTTP/1.1, where Chrome itself sends at most 6 at a time to a
// server; then more at once gains nothing. So the downloader measures instead of guessing:
//
// It starts at `start`, measures the speed for `measureMs`, then tries `step` more. They're kept if the
// speed rose by at least `gain` (a fifth), and it tries more again; else it goes back, and tries again
// after a wait that doubles each time it didn't help (things change: the video was paused, say). A
// request that had to be retried (the server said it's busy, say) sends it a step back down at once.
//
// Pure logic, no timers: the downloader calls update() every second with the bytes so far.

export interface TunerOptions {
  /** Requests at once to begin with (and never fewer). */
  start: number;
  step: number;
  max: number;
  /** How long each number is measured for. */
  measureMs: number;
  /** Time after a change before measuring: new requests take a moment to get going. */
  settleMs: number;
  /** Speed-up needed to keep more requests: 0.2 = 20 % faster. */
  gain: number;
  /** After more requests didn't help, wait this long before trying again; doubled each time, up to maxRetryMs. */
  retryMs: number;
  maxRetryMs: number;
}

export const TUNER_DEFAULTS: TunerOptions = {
  start: 6,
  step: 6,
  max: 24,
  measureMs: 10_000,
  settleMs: 3_000,
  gain: 0.2,
  retryMs: 60_000,
  maxRetryMs: 8 * 60_000,
};

export class ParallelTuner {
  /** Requests at once now. */
  limit: number;
  private readonly o: TunerOptions;
  /** The number known to work, and its speed (bytes/s). */
  private good: { limit: number; speed: number } | null = null;
  /** Where the current measurement started. */
  private from: { at: number; bytes: number } | null = null;
  private settleUntil: number;
  private changedAt: number;
  /** No trying more before this. */
  private probeAfter = 0;
  private wait: number;

  constructor(now: number, options: Partial<TunerOptions> = {}) {
    this.o = { ...TUNER_DEFAULTS, ...options };
    this.limit = this.o.start;
    this.wait = this.o.retryMs;
    this.settleUntil = now + this.o.settleMs;
    this.changedAt = now;
  }

  /** `bytes`: downloaded so far. Returns the new number of requests at once when it changes, else null. */
  update(now: number, bytes: number): number | null {
    if (now < this.settleUntil) return null;
    if (!this.from) {
      this.from = { at: now, bytes };
      return null;
    }
    const elapsed = now - this.from.at;
    if (elapsed < this.o.measureMs) return null;
    const speed = ((bytes - this.from.bytes) * 1000) / elapsed;
    this.from = { at: now, bytes };

    const good = this.good;
    if (good && this.limit > good.limit) {
      // Trying more than the number known to work: worth it?
      if (speed < good.speed * (1 + this.o.gain)) {
        this.probeAfter = now + this.wait;
        this.wait = Math.min(this.wait * 2, this.o.maxRetryMs);
        return this.change(good.limit, now);
      }
      this.wait = this.o.retryMs;
    }
    this.good = { limit: this.limit, speed };
    if (this.limit < this.o.max && now >= this.probeAfter) return this.change(Math.min(this.o.max, this.limit + this.o.step), now);
    return null;
  }

  /** A request had to be retried: a step back down (once per change), and no trying more for a while. */
  backOff(now: number): number | null {
    this.probeAfter = Math.max(this.probeAfter, now + this.wait);
    if (this.limit <= this.o.start || now - this.changedAt < this.o.settleMs) return null;
    const good = this.good;
    if (good && this.limit > good.limit) return this.change(good.limit, now);
    this.good = null; // measure the lower number afresh
    return this.change(Math.max(this.o.start, this.limit - this.o.step), now);
  }

  private change(limit: number, now: number): number {
    this.limit = limit;
    this.changedAt = now;
    this.settleUntil = now + this.o.settleMs;
    this.from = null;
    return limit;
  }
}
