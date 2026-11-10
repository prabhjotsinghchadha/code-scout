// ▶ buttons next to codes found in page text (including content added later); ★ for favourites, ✓ for
// codes already seen.
import { findCodes, formatCode, type VideoCode } from '../shared/codes';
import { sendToBackground } from '../shared/messages';
import { seenAgo } from '../shared/seen';
import { isStarred, onStarredChange } from './favourites';
import { onSeenChange, seenEntryFor } from './seen';
import { openSiteMenu } from './site-menu';
import { markUi, onUi } from './ui-events';

const BUTTON_CLASS = 'javtr-open-btn';
/** Elements whose text is never decorated (also used for the favourite marks, favourite-marks.ts). */
export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'svg', 'CANVAS', 'IFRAME',
]);

// Text nodes we created while splitting, so we never add a second button for the same code.
const processed = new WeakSet<Text>();
let observer: MutationObserver | null = null;
/** The code each button opens, for restyling when favourites change. */
const buttonCodes = new WeakMap<HTMLElement, VideoCode>();
let watchingStars = false;

function shouldSkip(node: Text): boolean {
  if (processed.has(node)) return true;
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return true;
    if (el.classList.contains(BUTTON_CLASS) || el.id === 'javtr-chip') return true;
  }
  return false;
}

function createButton(code: VideoCode): HTMLElement {
  const btn = markUi(document.createElement('span'));
  btn.className = BUTTON_CLASS;
  buttonCodes.set(btn, code);
  paint(btn, code);
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;

  // Input arrives via the click shield, so the page (and its ad scripts) never sees these
  // clicks, and the link the code sits in isn't followed.
  const open = () => void sendToBackground({ type: 'OPEN_CODE', code });
  onUi(btn, 'click', ({ button }) => button === 0 && open());
  onUi(btn, 'contextmenu', () => void openSiteMenu(code, btn.getBoundingClientRect(), { anchorEl: btn }));
  onUi(btn, 'keydown', ({ key }) => (key === 'Enter' || key === ' ') && open());
  return btn;
}

/** ▶; a filled star for a favourite; a ✓ for a code already seen (both still open the trailer). */
function paint(btn: HTMLElement, code: VideoCode) {
  const starred = isStarred(code);
  const seen = seenEntryFor(code);
  // ▶ with U+FE0E: as text, never the emoji some systems would draw for it.
  btn.textContent = starred ? '★' : seen ? '✓' : '▶\uFE0E';
  btn.classList.toggle('javtr-fav', starred);
  btn.classList.toggle('javtr-seen', !!seen);
  const notes = [starred && 'In your favourites', seen && `Seen ${seenAgo(seen.at, Date.now())}`].filter(Boolean);
  btn.title = [...notes, `Open trailer for ${formatCode(code)}`, 'right-click for more'].join(' · ');
}

function repaintAll() {
  document.querySelectorAll<HTMLElement>(`.${BUTTON_CLASS}`).forEach((btn) => {
    const code = buttonCodes.get(btn);
    if (code) paint(btn, code);
  });
}

function decorateTextNode(node: Text) {
  const text = node.data;
  const matches = findCodes(text);
  if (matches.length === 0) return;

  const frag = document.createDocumentFragment();
  let last = 0;
  for (const { code, index, length } of matches) {
    const end = index + length;
    const piece = document.createTextNode(text.slice(last, end));
    processed.add(piece);
    frag.append(piece, createButton(code));
    last = end;
  }
  const rest = document.createTextNode(text.slice(last));
  processed.add(rest);
  frag.append(rest);
  node.replaceWith(frag);
}

function scan(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.data.length >= 5 && !shouldSkip(t)) nodes.push(t);
  }
  nodes.forEach(decorateTextNode);
}

export function enableInline() {
  if (!watchingStars) {
    watchingStars = true;
    onStarredChange(repaintAll);
    onSeenChange(repaintAll);
  }
  scan(document.body);

  // Pick up content added later (infinite scroll, SPA navigation, ...).
  let pending: Node[] = [];
  let timer: number | undefined;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && n.classList.contains(BUTTON_CLASS)) return;
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

export function disableInline() {
  observer?.disconnect();
  observer = null;
  const parents = new Set<Node>();
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((b) => {
    if (b.parentNode) parents.add(b.parentNode);
    b.remove();
  });
  // Re-join the text we split and forget it, so turning the buttons back on finds the codes again.
  for (const parent of parents) {
    parent.normalize();
    parent.childNodes.forEach((n) => n instanceof Text && processed.delete(n));
  }
}
