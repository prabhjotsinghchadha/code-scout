// Video tools on this page or frame: their code (the downloader is large) loads only once there's a <video>.
// Used by the page (index.ts) and by frames (frame.ts), e.g. players embedded from other sites.

let wanted = false;
let loaded = false;
let stopWaiting: (() => void) | null = null;

/** Calls `found` once the page has a <video> (now, or when one is added). Returns a cancel function. */
function whenPageHasVideo(found: () => void): () => void {
  const videos = document.getElementsByTagName('video'); // live: checking it is cheap
  if (videos.length) {
    found();
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (!videos.length) return;
    observer.disconnect();
    found();
  });
  observer.observe(document, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Player keys (space, arrows, J/K/L…) on or off here: the click shield asks video-tools.ts about a key
 * only while this attribute is set (shield.iife.ts can't read the settings itself).
 */
export function setPlayerKeys(on: boolean) {
  document.documentElement.toggleAttribute('data-javtr-keys', on);
}

export function setVideoTools(on: boolean) {
  // Also stops the faster loading of video-boost.iife.ts here (it can't read the settings itself).
  if (!on) window.dispatchEvent(new CustomEvent('javtr:video-off'));
  if (on === wanted) return;
  wanted = on;
  stopWaiting?.();
  stopWaiting = null;
  const toggle = () => void import('./video-tools').then((m) => (wanted ? m.enableVideoTools() : m.disableVideoTools()));
  if (!on) {
    if (loaded) toggle();
    return;
  }
  stopWaiting = whenPageHasVideo(() => {
    stopWaiting = null;
    loaded = true;
    toggle();
  });
}
