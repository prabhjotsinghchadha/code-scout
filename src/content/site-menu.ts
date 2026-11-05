// Small floating menu: open a code on javtrailers or on any of the user's "Open on" sites.
import { formatCode, type VideoCode } from '../shared/codes';
import { sendToBackground } from '../shared/messages';
import { fillTemplate } from '../shared/open-on';
import { getSettings } from '../shared/storage';

let menu: HTMLDivElement | null = null;
let onClose: (() => void) | null = null;
/** The element that opened the menu; clicks on it toggle instead of counting as "outside". */
let anchorEl: Element | null = null;

function item(label: string, onClick: () => void, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
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

export function isSiteMenuOpen() {
  return !!menu;
}

export function closeSiteMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', closeSiteMenu, true);
  onClose?.();
  onClose = null;
  anchorEl = null;
}

/** Show the menu for `code` just below (or above) `anchor`. */
export async function openSiteMenu(
  code: VideoCode,
  anchor: DOMRect,
  opts: { onClose?: () => void; anchorEl?: Element } = {},
) {
  closeSiteMenu();
  const { openOnSites } = await getSettings();

  const el = document.createElement('div');
  el.id = 'javtr-menu';
  el.setAttribute('role', 'menu');
  const title = document.createElement('div');
  title.className = 'javtr-menu-title';
  title.textContent = formatCode(code);
  el.append(
    title,
    item('▶ Open trailer', () => void sendToBackground({ type: 'OPEN_CODE', code })),
    item('Search JavTrailers', () => void sendToBackground({ type: 'OPEN_CODE', code, mode: 'search' })),
    Object.assign(document.createElement('hr'), { className: 'javtr-menu-sep' }),
  );
  if (openOnSites.length) {
    for (const site of openOnSites) {
      el.append(item(site.name, () => void sendToBackground({ type: 'OPEN_URLS', urls: [fillTemplate(site.template, code)] })));
    }
    if (openOnSites.length > 1) {
      const urls = openOnSites.map((s) => fillTemplate(s.template, code));
      el.append(item(`Open on all ${urls.length} sites`, () => void sendToBackground({ type: 'OPEN_URLS', urls }), 'javtr-menu-all'));
    }
  } else {
    el.append(item('+ Add sites in Settings…', () => void sendToBackground({ type: 'OPEN_OPTIONS' }), 'javtr-menu-muted'));
  }
  // Keep focus/caret in a text field the menu was opened from.
  el.addEventListener('mousedown', (e) => e.preventDefault());

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
  window.addEventListener('scroll', closeSiteMenu, { capture: true, passive: true });
}
