// Marks for favourites on pages (also in content loaded later):
// - ♥ after a favourite actress's name, wherever it appears. A heart, not a star, as a starred code's
//   button is already a ★ (inline.ts) and the two often sit side by side. The badge goes right after the
//   piece of text with her name in it, without splitting that text, so the ▶ buttons and these marks never
//   disturb each other. Clicking it opens her page.
// - # at the end of a link to a favourite tag's page ("NTR" in a video's list of genres), on tag links only:
//   words like "affair" in titles are left alone. It's part of the link, so clicking it follows the link.
import { actressLink, actressMatcher, getActresses, nameKey, onActressesChanged, type Actress } from '../shared/actresses';
import { sendToBackground } from '../shared/messages';
import { getTags, onTagsChanged, tagFinder, tagNameKey, type Tag } from '../shared/tags';
import { SKIP_TAGS } from './inline';
import { markUi, onUi, UI_ATTR } from './ui-events';

const ACTRESS_CLASS = 'javtr-actress';
const TAG_CLASS = 'javtr-tag';

/** Favourite actresses by nameKey. */
let byKey = new Map<string, Actress>();
let findActresses: (text: string) => string[] = () => [];
let tagCount = 0;
let findTag: (url: string, text: string) => Tag | undefined = () => undefined;
let enabled = false;
let observer: MutationObserver | null = null;
let watching: Promise<void> | null = null;

async function loadActresses() {
  const actresses = await getActresses();
  byKey = new Map(actresses.map((a) => [nameKey(a.name), a]));
  findActresses = actressMatcher(actresses.map((a) => a.name));
}

async function loadTags() {
  const tags = await getTags();
  tagCount = tags.length;
  findTag = tagFinder(tags);
}

const anything = () => byKey.size > 0 || tagCount > 0;

function skip(node: Node): boolean {
  for (let el = node instanceof Element ? node : node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable || el.hasAttribute(UI_ATTR)) return true;
  }
  return false;
}

// --- Actresses ---

function actressBadge(name: string): HTMLElement {
  const b = markUi(document.createElement('span'));
  b.className = ACTRESS_CLASS;
  b.dataset.name = nameKey(name);
  b.textContent = '♥';
  b.title = `Favourite performer: ${name} · click to open`;
  b.setAttribute('role', 'button');
  b.tabIndex = 0;
  // Input arrives via the click shield, so the page never sees it and a link around the name isn't followed.
  const open = () => {
    const actress = byKey.get(nameKey(name));
    if (actress) void sendToBackground({ type: 'OPEN_URLS', urls: [actressLink(actress)] });
  };
  onUi(b, 'click', ({ button }) => button === 0 && open());
  onUi(b, 'keydown', ({ key }) => (key === 'Enter' || key === ' ') && open());
  return b;
}

/**
 * Names already marked after `node` in its parent: it was marked before, or it is a piece of marked text
 * that inline.ts split to put a ▶ in (the badge then follows the last piece).
 */
function markedAfter(node: Text): Set<string> {
  const names = new Set<string>();
  for (let el = node.nextSibling; el; el = el.nextSibling) {
    if (el instanceof HTMLElement && el.classList.contains(ACTRESS_CLASS)) names.add(el.dataset.name ?? '');
  }
  return names;
}

function markText(node: Text) {
  if (node.data.length < 2 || skip(node)) return;
  const names = findActresses(node.data);
  if (!names.length) return;
  const marked = markedAfter(node);
  const badges = names.filter((n) => !marked.has(nameKey(n))).map(actressBadge);
  if (badges.length) node.after(...badges);
}

// --- Tags ---

/** A link's own text, without our marks in it. */
function linkText(a: HTMLAnchorElement): string {
  let text = '';
  const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skip(n)) text += (n as Text).data;
  return text;
}

function markLink(a: HTMLAnchorElement) {
  if (a.querySelector(`.${TAG_CLASS}`) || skip(a)) return;
  const tag = findTag(a.href, linkText(a));
  if (!tag) return;
  // Not our UI (no click shield): it's part of the link, and clicking it follows the link like the tag does.
  const mark = document.createElement('span');
  mark.className = TAG_CLASS;
  mark.dataset.tag = tagNameKey(tag.name);
  mark.textContent = '#';
  mark.title = `Favourite genre: ${tag.name}`;
  mark.setAttribute('aria-label', mark.title);
  a.append(mark);
}

// --- Scanning ---

function scan(root: Node) {
  if (!anything()) return;
  if (root instanceof Text) {
    if (byKey.size) markText(root);
    const a = root.parentElement?.closest<HTMLAnchorElement>('a[href]');
    if (a && tagCount) markLink(a);
    return;
  }
  if (!(root instanceof Element)) return;
  if (byKey.size) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    nodes.forEach(markText); // after walking: marking adds nodes
  }
  if (tagCount) {
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')];
    const own = root.closest<HTMLAnchorElement>('a[href]');
    if (own) links.push(own);
    links.forEach(markLink);
  }
}

function clear(className: string) {
  document.querySelectorAll(`.${className}`).forEach((m) => m.remove());
}

/** Marks again from scratch, after favourites of the kind `className` marks were added or removed. */
function refresh(className: string) {
  clear(className);
  if (enabled) scan(document.body);
}

export async function enableFavouriteMarks() {
  enabled = true;
  watching ??= Promise.all([loadActresses(), loadTags()]).then(() => {
    onActressesChanged(() => void loadActresses().then(() => refresh(ACTRESS_CLASS)));
    onTagsChanged(() => void loadTags().then(() => refresh(TAG_CLASS)));
  });
  await watching;
  if (!enabled || observer) return;
  scan(document.body);

  // Pick up content added later (infinite scroll, SPA navigation, ...).
  let pending: Node[] = [];
  let timer: number | undefined;
  observer = new MutationObserver((mutations) => {
    if (!anything()) return;
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && (n.hasAttribute(UI_ATTR) || n.classList.contains(TAG_CLASS))) return; // ours
        if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) pending.push(n);
      });
    }
    if (pending.length && timer === undefined) {
      timer = window.setTimeout(() => {
        const batch = pending;
        pending = [];
        timer = undefined;
        batch.forEach((n) => n.isConnected && scan(n));
      }, 300);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function disableFavouriteMarks() {
  enabled = false;
  observer?.disconnect();
  observer = null;
  clear(ACTRESS_CLASS);
  clear(TAG_CLASS);
}
