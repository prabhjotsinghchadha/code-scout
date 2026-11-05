// Pop-up blocker, content-script side (on sites where "Block pop-ups" is on).
//  - Real clicks on links that open a new tab: links to the same site (and Ctrl/⌘/Shift/middle-clicks)
//    are let through and announced to the background, which closes any other new tab this site opens.
//    Links to other sites in a new tab — the usual invisible ad overlay — are blocked.
//  - Relays blocks reported by the page-side script (popup-block.iife.ts) to the toolbar badge, and
//    re-opens the site's own page when that's what was blocked right after a click.
import { sameSite } from '../shared/hosts';
import { sendToBackground, type Message } from '../shared/messages';

const SAME_WINDOW = new Set(['_self', '_top', '_parent']);
let enabled = false;

const send = (message: Message) => void sendToBackground(message).catch(() => {});

function linkIn(e: Event): HTMLAnchorElement | HTMLAreaElement | null {
  for (const node of e.composedPath()) {
    if ((node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) && node.href) return node;
  }
  return null;
}

function opensNewTab(link: HTMLAnchorElement | HTMLAreaElement) {
  const target = (link.target || document.querySelector('base[target]')?.getAttribute('target') || '').toLowerCase();
  return !!target && !SAME_WINDOW.has(target);
}

function onClick(e: MouseEvent) {
  if (!e.isTrusted) return;
  const link = linkIn(e);
  if (!link) return;
  // The user asked for a new tab themselves.
  if (e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey) return send({ type: 'ALLOW_NEW_TAB', ms: 3000 });
  if (e.button !== 0 || !opensNewTab(link)) return;
  if (sameSite(link.href, location.href)) return send({ type: 'ALLOW_NEW_TAB', ms: 3000 });
  e.preventDefault(); // a new tab to another site: almost always an ad overlay
  send({ type: 'POPUP_BLOCKED' });
}

// Right-click → "Open link in new tab" from Chrome's own menu.
function onContextMenu(e: MouseEvent) {
  if (e.isTrusted && linkIn(e)) send({ type: 'ALLOW_NEW_TAB', ms: 30_000 });
}

function onPageBlocked(e: Event) {
  let info = { url: '', reopen: false };
  try {
    info = JSON.parse(String((e as CustomEvent).detail));
  } catch {
    // Malformed detail; just count it.
  }
  send({ type: 'POPUP_BLOCKED' });
  if (info.reopen && sameSite(info.url, location.href)) send({ type: 'OPEN_URLS', urls: [info.url] });
}

export function enablePopupGuard() {
  if (enabled) return;
  enabled = true;
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('javtr:popup-blocked', onPageBlocked);
}

export function disablePopupGuard() {
  if (!enabled) return;
  enabled = false;
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('auxclick', onClick, true);
  window.removeEventListener('contextmenu', onContextMenu, true);
  document.removeEventListener('javtr:popup-blocked', onPageBlocked);
}
