// xchina.tube: bypass the 2-minute preview cap and the 5-video daily limit.
// Runs at document_start in the MAIN world so prototype patches are in place before Video.js loads.
//
// The preview cap lives in setupPlayer() inside main.*.js. A Video.js timeupdate/seeking handler
// checks C.currentTime() >= 120 and then executes C.pause(), v() via the comma operator. v() sets
// an Angular flag (valid = false) which hides the video and disposes the player.
//
// Strategy:
//  1. Wrap addEventListener on <video> elements so timeupdate/seeking handlers set an inCapEvent
//     flag while they run.
//  2. Override the currentTime getter: during those handlers return min(real, 119.9) so the >= 120
//     check never passes — this prevents BOTH C.pause() and v() from being reached (&&).
//  3. Override pause() to no-op during those handlers as a safety net.
//  4. CSS hides the paywall overlay and keeps the video wrapper visible.
//  5. Clear the encrypted daily-watch counter (CapacitorStorage.history) so the 5/day gate is reset.
(() => {
  try { localStorage.removeItem('CapacitorStorage.history'); } catch {}

  let inCapEvent = false;

  const nativeAddEvent = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (
      this instanceof HTMLVideoElement &&
      (type === 'timeupdate' || type === 'seeking') &&
      typeof listener === 'function'
    ) {
      const orig = listener;
      listener = function (this: HTMLVideoElement, ev: Event) {
        inCapEvent = true;
        try {
          return (orig as Function).call(this, ev);
        } finally {
          inCapEvent = false;
        }
      } as EventListener;
    }
    return nativeAddEvent.call(this, type, listener, options);
  };

  const ctDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    get() {
      const real = ctDesc.get!.call(this);
      return inCapEvent && real >= 120 ? 119.9 : real;
    },
    set(v: number) {
      ctDesc.set!.call(this, v);
    },
    configurable: true,
    enumerable: true,
  });

  const nativePause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    if (inCapEvent) return;
    return nativePause.call(this);
  };

  const injectCSS = () => {
    const s = document.createElement('style');
    s.textContent =
      '.video-overlay-poster{display:none!important}' +
      '.video-wrapper[hidden]{display:block!important}';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) injectCSS();
  else
    new MutationObserver((_, o) => {
      if (document.head) {
        injectCSS();
        o.disconnect();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
})();

export {};
