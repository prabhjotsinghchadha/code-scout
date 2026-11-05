// Small floating menu: open a code on javtrailers or on any of the user's "Open on" sites, or star it.
import { formatCode, type VideoCode } from '../shared/codes';
import { sendToBackground } from '../shared/messages';
import type { FavouritePage } from '../shared/favourites';
import { fillTemplate } from '../shared/open-on';
import { seenAgo } from '../shared/seen';
import { getSettings } from '../shared/storage';
import { isStarred, thisPage, toggleStar } from './favourites';
import { seenEntryFor } from './seen';
import { markUi, onUi } from './ui-events';

let menu: HTMLDivElement | null = null;
let onClose: (() => void) | null = null;
/** The element that opened the menu; clicks on it toggle instead of counting as "outside". */
let anchorEl: Element | null = null;

function item(label: string, onClick: () => void, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  onUi(b, 'click', ({ button }) => {
    if (button !== 0) return;
    onClick();
    closeSiteMenu();
  });
  return b;
}

const onOutside = (e: Event) => {
  const path = e.composedPath();
  if (menu && !path.includes(menu) && !(anchorEl && path.includes(anchorEl))) closeSiteMenu();
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeSiteMenu();
};
// Keys pressed on our own UI (menu, ▶, chip) reach us only via the shield's javtr:keydown.
const onUiKey = (e: Event) => {
  if ((e as CustomEvent<{ key?: string }>).detail?.key === 'Escape') closeSiteMenu();
};

export function isSiteMenuOpen() {
  return !!menu;
}

export function closeSiteMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('javtr:keydown', onUiKey);
  window.removeEventListener('scroll', closeSiteMenu, true);
  onClose?.();
  onClose = null;
  anchorEl = null;
}

/**
 * Show the menu for `code` just below (or above) `anchor`. `page` gives the page to save when the code is
 * starred (default: this page; null for none, e.g. for a code that was only typed).
 */
export async function openSiteMenu(
  code: VideoCode,
  anchor: DOMRect,
  opts: { onClose?: () => void; anchorEl?: Element; page?: () => FavouritePage | null } = {},
) {
  closeSiteMenu();
  const { openOnSites } = await getSettings();

  const el = markUi(document.createElement('div'));
  el.id = 'javtr-menu';
  el.setAttribute('role', 'menu');
  const title = document.createElement('div');
  title.className = 'javtr-menu-title';
  title.textContent = formatCode(code);
  const seen = seenEntryFor(code);
  if (seen) {
    const note = Object.assign(document.createElement('span'), {
      className: 'javtr-menu-seen',
      textContent: `✓ Seen ${seenAgo(seen.at, Date.now())}`,
    });
    title.append(note);
  }
  el.append(
    title,
    item('▶ Open trailer', () => void sendToBackground({ type: 'OPEN_CODE', code })),
    item('Search JavTrailers', () => void sendToBackground({ type: 'OPEN_CODE', code, mode: 'search' })),
    isStarred(code)
      ? item('★ Remove from favourites', () => void toggleStar(code, null))
      : item('☆ Add to favourites', () => void toggleStar(code, (opts.page ?? thisPage)())),
    Object.assign(document.createElement('hr'), { className: 'javtr-menu-sep' }),
  );
  if (openOnSites.length) {
    for (const site of openOnSites) {
      el.append(item(site.name, () => void sendToBackground({ type: 'OPEN_URLS', urls: [fillTemplate(site.template, code)], code })));
    }
    if (openOnSites.length > 1) {
      const urls = openOnSites.map((s) => fillTemplate(s.template, code));
      el.append(item(`Open on all ${urls.length} sites`, () => void sendToBackground({ type: 'OPEN_URLS', urls, code }), 'javtr-menu-all'));
    }
  } else {
    el.append(item('+ Add sites in Settings…', () => void sendToBackground({ type: 'OPEN_OPTIONS' }), 'javtr-menu-muted'));
  }

  el.style.visibility = 'hidden';
  document.documentElement.append(el);
  const { offsetWidth: w, offsetHeight: h } = el;
  let top = anchor.bottom + 4;
  if (top + h > innerHeight - 4) top = Math.max(4, anchor.top - h - 4);
  const left = Math.max(8, Math.min(anchor.left, innerWidth - w - 8));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = '';

  menu = el;
  onClose = opts.onClose ?? null;
  anchorEl = opts.anchorEl ?? null;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('javtr:keydown', onUiKey);
  window.addEventListener('scroll', closeSiteMenu, { capture: true, passive: true });
}
