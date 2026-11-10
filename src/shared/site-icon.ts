// A site's icon for quick links: Chrome's own copy of the site's favicon (read locally through the
// "favicon" permission, nothing is fetched from the site), or a coloured letter when Chrome has none.
import { linkLabel, type QuickLink } from './quick-links.ts';

const SIZE = 32;
/** Chrome answers for any page; this one has no icon, so it gets Chrome's default globe. */
const NO_ICON_PAGE = 'https://no-icon.invalid/';

function faviconUrl(pageUrl: string): string | null {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(SIZE));
    return url.href;
  } catch {
    return null;
  }
}

/** A short fingerprint of an image's pixels, to tell Chrome's default globe from a real icon. */
async function fingerprint(src: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let hash = 0;
    for (let i = 0; i < data.length; i++) hash = (hash * 31 + data[i]) | 0;
    return String(hash);
  } catch {
    return null;
  }
}

let noIcon: Promise<string | null> | null = null;
const found = new Map<string, Promise<string | null>>();

// Sites known to have an icon, remembered between openings of the popup (localStorage), so their tiles
// show it at once instead of comparing pixels again. Sites without one are checked every time: Chrome
// gets their icon once they're visited.
const KNOWN_KEY = 'sitesWithIcon';
let known: Set<string> | null = null;

function knownSites(): Set<string> {
  if (!known) {
    try {
      known = new Set(JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as string[]);
    } catch {
      known = new Set();
    }
  }
  return known;
}

function rememberSite(origin: string) {
  const sites = knownSites();
  if (sites.has(origin)) return;
  sites.add(origin);
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify([...sites]));
  } catch {
    // Not remembered: it's checked again next time.
  }
}

/** The favicon's address for this page's site, or null if Chrome only has its default icon. */
function siteFavicon(pageUrl: string): Promise<string | null> {
  const src = faviconUrl(pageUrl);
  if (!src) return Promise.resolve(null);
  const origin = new URL(pageUrl).origin;
  let result = found.get(origin);
  if (!result) {
    if (knownSites().has(origin)) {
      result = Promise.resolve(src);
    } else {
      const noIconSrc = faviconUrl(NO_ICON_PAGE)!;
      noIcon ??= fingerprint(noIconSrc);
      result = Promise.all([fingerprint(src), noIcon]).then(([icon, none]) => {
        if (!icon || icon === none) return null;
        rememberSite(origin);
        return src;
      });
    }
    found.set(origin, result);
  }
  return result;
}

/** A colour for the site's letter, the same every time for the same host. */
function hue(host: string): number {
  let h = 0;
  for (const ch of host) h = (h * 33 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A square icon for the link's site. */
export function siteIcon(link: QuickLink, size = 16): HTMLSpanElement {
  const { host } = linkLabel(link);
  const dot = link.name.indexOf(' · ');
  const letter = (dot > 0 ? link.name : host).trim().charAt(0).toUpperCase() || '?';
  const el = Object.assign(document.createElement('span'), { className: 'site-icon' });
  el.style.setProperty('--size', `${size}px`);
  el.style.setProperty('--hue', String(hue(host)));
  el.setAttribute('aria-hidden', 'true');
  void siteFavicon(link.url).then((src) => {
    if (src) {
      el.classList.add('img');
      el.replaceChildren(Object.assign(document.createElement('img'), { src, alt: '', width: size, height: size }));
    } else {
      el.classList.add('letter');
      el.textContent = letter;
    }
  });
  return el;
}
