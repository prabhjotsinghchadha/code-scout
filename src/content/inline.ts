// ▶ buttons next to codes found in page text (including content added later).
import { findCodes, formatCode, type VideoCode } from '../shared/codes';
import { sendToBackground } from '../shared/messages';

const BUTTON_CLASS = 'javtr-open-btn';
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'svg', 'CANVAS', 'IFRAME',
]);

// Text nodes we created while splitting, so we never add a second button for the same code.
const processed = new WeakSet<Text>();
let observer: MutationObserver | null = null;

function shouldSkip(node: Text): boolean {
  if (processed.has(node)) return true;
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return true;
    if (el.classList.contains(BUTTON_CLASS) || el.id === 'javtr-chip') return true;
  }
  return false;
}

function createButton(code: VideoCode): HTMLElement {
  const btn = document.createElement('span');
  btn.className = BUTTON_CLASS;
  btn.textContent = '▶';
  btn.title = `Open trailer for ${formatCode(code)}`;
  btn.setAttribute('role', 'button');
  btn.tabIndex = 0;

  const open = (e: Event) => {
    // The code is often inside a link; don't let the page follow it.
    e.preventDefault();
    e.stopPropagation();
    void sendToBackground({ type: 'OPEN_CODE', code });
  };
  btn.addEventListener('click', open, true);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') open(e);
  });
  // Some sites act on mousedown/pointerdown; keep those from reaching them too.
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick']) {
    btn.addEventListener(type, (e) => e.stopPropagation(), true);
  }
  return btn;
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
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((b) => b.remove());
}
