// Pop-up blocker, page side. Runs in the page's own JavaScript world at document_start, and only on
// sites where the user turned "Block pop-ups" on (the background registers it with chrome.scripting).
//
// Stops the usual ad tricks:
//  - window.open() pop-ups / pop-unders (also via a fresh iframe's window.open)
//  - scripted clicks on links that open a new tab (a.click(), dispatchEvent)
//  - sending this tab to another site by script (the "tab-under": the clicked video opens in a new
//    tab while this tab is redirected to an ad)
// When the site itself opens one of its own pages this way after a click (e.g. a video), the content
// script re-opens it in a new tab, so the user still gets what they clicked.
//
// No chrome.* APIs here: blocks are reported to the content script with a DOM event.
(() => {
  const w = window as Window & { __javtrPopupBlock?: boolean };
  if (w.__javtrPopupBlock) return;
  w.__javtrPopupBlock = true;

  const baseDomain = (host: string) => {
    const h = host.toLowerCase().replace(/^www\./, '');
    return /^[\d.]+$/.test(h) ? h : h.split('.').slice(-2).join('.');
  };
  const toUrl = (u: unknown) => {
    try {
      return new URL(String(u ?? ''), location.href);
    } catch {
      return null;
    }
  };
  const isSameSite = (url: URL) => baseDomain(url.hostname) === baseDomain(location.hostname);
  const userClicked = () => navigator.userActivation?.isActive ?? false; // missing in old browsers

  /** Tell the content script; `reopen` = the site's own page opened right after a click. */
  const block = (target: unknown) => {
    const url = toUrl(target);
    const reopen = !!url && /^https?:$/.test(url.protocol) && isSameSite(url) && userClicked() && window === window.top;
    document.dispatchEvent(
      new CustomEvent('javtr:popup-blocked', { detail: JSON.stringify({ url: url?.href ?? '', reopen }) }),
    );
  };

  // A do-nothing stand-in for the opened window, so scripts that check the result (or write to it)
  // don't fall back to redirecting this tab.
  const absorb: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'closed') return false;
      if (prop === 'then') return undefined; // not a thenable
      if (prop === Symbol.toPrimitive) return () => '';
      return absorb;
    },
    set: () => true,
    apply: () => absorb,
    construct: () => absorb as object,
  });

  const nativeOpen = window.open;
  const SAME_WINDOW = new Set(['_self', '_top', '_parent']);
  const blockedOpen = function (this: unknown, url?: string | URL, target?: string, features?: string) {
    // Opening in this same window is a navigation, which the navigate guard below checks.
    if (target && SAME_WINDOW.has(target.toLowerCase())) return nativeOpen.call(window, url, target, features);
    block(url);
    return absorb as Window;
  };
  window.open = blockedOpen;

  // Ad scripts grab an untouched window.open from a new iframe; give those the blocked one too.
  const frameWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (frameWindow?.get) {
    const get = frameWindow.get;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      ...frameWindow,
      get(this: HTMLIFrameElement) {
        const win = get.call(this) as Window | null;
        try {
          if (win && win.open !== blockedOpen) win.open = blockedOpen;
        } catch {
          // Cross-origin frame: not reachable (and not ours to patch).
        }
        return win;
      },
    });
  }

  // Scripted clicks on links that open a new tab (real clicks never go through these).
  const newTabLink = (el: unknown): HTMLAnchorElement | HTMLAreaElement | null => {
    if (!(el instanceof Element)) return null;
    const link = el.closest<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]');
    if (!link) return null;
    const target = (link.target || document.querySelector('base[target]')?.getAttribute('target') || '').toLowerCase();
    return target && !SAME_WINDOW.has(target) ? link : null;
  };
  const nativeClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function (this: HTMLElement) {
    const link = newTabLink(this);
    if (link) return block(link.href);
    return nativeClick.call(this);
  };
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (this: EventTarget, event: Event) {
    const link = event.type === 'click' ? newTabLink(this) : null;
    if (link) {
      block(link.href);
      return false;
    }
    return nativeDispatch.call(this, event);
  };

  // Tab-under: cancel script redirects of this tab to another site. Links the user clicks still work.
  type NavigateEvent = Event & {
    cancelable: boolean;
    userInitiated: boolean;
    navigationType: string;
    destination: { url: string };
  };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (window === window.top && navigation) {
    navigation.addEventListener('navigate', (e) => {
      const nav = e as NavigateEvent;
      if (!nav.cancelable || nav.userInitiated || nav.navigationType === 'traverse' || nav.navigationType === 'reload') return;
      const url = toUrl(nav.destination?.url);
      if (!url || !/^https?:$/.test(url.protocol) || isSameSite(url)) return;
      nav.preventDefault();
      document.dispatchEvent(
        new CustomEvent('javtr:popup-blocked', { detail: JSON.stringify({ url: url.href, reopen: false }) }),
      );
    });
  }

  // ─── xchina.tube: bypass the "buy membership" paywall and the 5-videos-per-day limit ───
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'xchina.tube' || host.endsWith('.xchina.tube')) {
    const PAYWALL_TEXT = /premium|membership|purchase|per day|videos per day|120万/i;

    /** Remove any overlay/modal that looks like the paywall. */
    const killPaywall = () => {
      const candidates = document.querySelectorAll<HTMLElement>(
        'div, section, aside, dialog, [role="dialog"], [role="alertdialog"]',
      );
      for (const el of candidates) {
        const style = getComputedStyle(el);
        const isOverlay =
          (style.position === 'fixed' || style.position === 'absolute') &&
          parseInt(style.zIndex, 10) >= 1000 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden';
        if (!isOverlay) continue;
        const text = el.textContent ?? '';
        if (PAYWALL_TEXT.test(text) && el.querySelector('video') === null) {
          el.remove();
        }
      }
      // Also nuke full-screen semi-transparent backdrops that sit behind the modal.
      for (const el of document.querySelectorAll<HTMLElement>('.modal-backdrop, .overlay, .backdrop')) {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' && parseFloat(style.opacity) > 0) el.remove();
      }
    };

    /** Clear localStorage keys that track the daily view counter. */
    const clearDailyCount = () => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /daily|count|watch|free|limit|video.?num|per.?day/i.test(k)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    };

    /** Unpause the main video if the paywall paused it. */
    const unpauseVideo = () => {
      const video = document.querySelector('video');
      if (video && video.paused && !video.ended) {
        video.play().catch(() => {});
      }
    };

    /** Intercept alert/confirm that show the limit message. */
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;
    window.alert = (msg?: string) => {
      if (msg && PAYWALL_TEXT.test(msg)) return;
      return nativeAlert.call(window, msg);
    };
    window.confirm = (msg?: string) => {
      if (msg && PAYWALL_TEXT.test(msg)) return true; // auto-accept so the site doesn't block
      return nativeConfirm.call(window, msg);
    };

    // Run once on load, then watch for dynamically-inserted paywalls.
    clearDailyCount();
    killPaywall();
    unpauseVideo();

    const observer = new MutationObserver(() => {
      killPaywall();
      unpauseVideo();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Re-clear the counter periodically in case the site re-writes it.
    const interval = setInterval(clearDailyCount, 10_000);
    window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  }
})();

export {};
