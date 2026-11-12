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
    const PAYWALL_TEXT = /premium|membership|purchase|per day|videos per day|at most|120万|purchase now/i;

    /** Check if an element is a full-viewport or near-full-viewport overlay. */
    const isFullOverlay = (el: HTMLElement): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (style.position !== 'fixed' && style.position !== 'absolute') return false;
      const zIndex = parseInt(style.zIndex, 10);
      if (isNaN(zIndex) || zIndex < 100) return false;
      // Must cover a significant portion of the viewport.
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return rect.width >= vw * 0.5 && rect.height >= vh * 0.5;
    };

    /** Remove any overlay/modal that looks like the paywall. */
    const killPaywall = () => {
      // Strategy 1: find elements whose text matches the paywall message and remove their overlay ancestor.
      const all = document.querySelectorAll<HTMLElement>('div, section, aside, dialog, [role="dialog"], [role="alertdialog"], [class*="modal"], [class*="overlay"], [class*="popup"], [class*="mask"], [class*="paywall"], [class*="premium"]');
      for (const el of all) {
        const text = el.textContent ?? '';
        if (!PAYWALL_TEXT.test(text)) continue;
        // Walk up to find the overlay container (fixed/absolute, high z-index, full-viewport).
        let target: HTMLElement | null = el;
        for (let i = 0; i < 6 && target; i++) {
          if (isFullOverlay(target)) break;
          target = target.parentElement;
        }
        if (target && isFullOverlay(target)) {
          target.remove();
          continue;
        }
        // If no full overlay ancestor found, remove the element itself if it's positioned.
        const style = getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex, 10) >= 100) {
          el.remove();
        }
      }

      // Strategy 2: nuke any full-viewport fixed element with high z-index that has paywall-ish text.
      for (const el of document.querySelectorAll<HTMLElement>('body > div, body > section, body > aside')) {
        if (!isFullOverlay(el)) continue;
        const text = el.textContent ?? '';
        if (PAYWALL_TEXT.test(text)) el.remove();
      }

      // Strategy 3: remove common backdrop/mask elements.
      for (const el of document.querySelectorAll<HTMLElement>('.modal-backdrop, .overlay, .backdrop, .mask, [class*="backdrop"], [class*="mask"]')) {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' && parseFloat(style.opacity) > 0) el.remove();
      }
    };

    /** Clear localStorage keys that track the daily view counter. */
    const clearDailyCount = () => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /daily|count|watch|free|limit|video.?num|per.?day|view.?count|today/i.test(k)) keys.push(k);
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

    /** Intercept alert/confirm/prompt that show the limit message. */
    const nativeAlert = window.alert;
    const nativeConfirm = window.confirm;
    const nativePrompt = window.prompt;
    window.alert = (msg?: string) => {
      if (msg && PAYWALL_TEXT.test(msg)) return;
      return nativeAlert.call(window, msg);
    };
    window.confirm = (msg?: string) => {
      if (msg && PAYWALL_TEXT.test(msg)) return true; // auto-accept so the site doesn't block
      return nativeConfirm.call(window, msg);
    };
    window.prompt = (msg?: string) => {
      if (msg && PAYWALL_TEXT.test(msg)) return '';
      return nativePrompt.call(window, msg);
    };

    // Also patch on window.top in case the site calls top.confirm / top.alert.
    try {
      const top = window.top;
      if (top && top !== window) {
        if (!top.__javtrXchinaPatched) {
          top.__javtrXchinaPatched = true;
          const tAlert = top.alert;
          const tConfirm = top.confirm;
          const tPrompt = top.prompt;
          top.alert = (msg?: string) => {
            if (msg && PAYWALL_TEXT.test(msg)) return;
            return tAlert.call(top, msg);
          };
          top.confirm = (msg?: string) => {
            if (msg && PAYWALL_TEXT.test(msg)) return true;
            return tConfirm.call(top, msg);
          };
          top.prompt = (msg?: string) => {
            if (msg && PAYWALL_TEXT.test(msg)) return '';
            return tPrompt.call(top, msg);
          };
        }
      }
    } catch {
      // Cross-origin top: can't patch.
    }

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
