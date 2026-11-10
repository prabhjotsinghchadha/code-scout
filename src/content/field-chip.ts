// Floating "NSFS-484  ▶ Open  Search  ☆  Sites ▾" chip under a text field while a code is typed in it.
import { formatCode, type VideoCode } from '../shared/codes';
import { sendToBackground } from '../shared/messages';
import { codeInEditable, editableFrom, readEditable, type Editable } from './editable';
import { isStarred, onStarredChange, shownOnPage, thisPage, toggleStar } from './favourites';
import { closeSiteMenu, isSiteMenuOpen, openSiteMenu } from './site-menu';
import { markUi, onUi, UI_ATTR } from './ui-events';

let chip: HTMLDivElement | null = null;
let label: HTMLSpanElement;
let star: HTMLButtonElement;
let watchingStars = false;
let current: { el: Editable; code: VideoCode } | null = null;
/** Field text at the moment the user dismissed the chip; it stays hidden until the text changes. */
let dismissed: { el: Editable; text: string } | null = null;
let inputTimer: number | undefined;
let blurTimer: number | undefined;

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.className = className;
  onUi(b, 'click', ({ button }) => button === 0 && onClick());
  return b;
}

function build(): HTMLDivElement {
  // Marked as extension UI: the click shield hides its clicks from the page and keeps
  // focus (and the caret) in the text field.
  const el = markUi(document.createElement('div'));
  el.id = 'javtr-chip';
  el.hidden = true;
  label = document.createElement('span');
  label.className = 'javtr-code';
  star = button('☆', 'javtr-secondary javtr-star', () => {
    closeSiteMenu();
    if (!current) return;
    const { code, el: field } = current;
    void toggleStar(code, isStarred(code) || !shownOnPage(code, field) ? null : thisPage());
  });
  el.append(
    label,
    button('▶\uFE0E Open', 'javtr-primary', () => {
      closeSiteMenu();
      if (current) void sendToBackground({ type: 'OPEN_CODE', code: current.code });
    }),
    button('Search', 'javtr-secondary', () => {
      closeSiteMenu();
      if (current) void sendToBackground({ type: 'OPEN_CODE', code: current.code, mode: 'search' });
    }),
    star,
    button('Sites ▾', 'javtr-secondary', () => {
      if (!current || !chip) return;
      if (isSiteMenuOpen()) return closeSiteMenu();
      const { code, el: field } = current;
      void openSiteMenu(code, chip.getBoundingClientRect(), {
        anchorEl: chip,
        page: () => (shownOnPage(code, field) ? thisPage() : null),
      });
    }),
    button('×', 'javtr-close', dismiss),
  );
  el.querySelector('.javtr-close')!.setAttribute('aria-label', 'Dismiss');
  document.documentElement.append(el);
  return el;
}

/** ☆ / ★ for the code in the chip. */
function paintStar() {
  if (!current || !star) return;
  const on = isStarred(current.code);
  star.textContent = on ? '★' : '☆';
  star.classList.toggle('javtr-on', on);
  star.title = on ? 'Remove from favourites' : 'Add to favourites';
  star.setAttribute('aria-label', star.title);
}

function position() {
  if (!chip || !current || chip.hidden) return;
  const r = current.el.getBoundingClientRect();
  if (!current.el.isConnected || (r.width === 0 && r.height === 0)) return hide();
  const { offsetWidth: w, offsetHeight: h } = chip;
  let top = r.bottom + 6;
  if (top + h > innerHeight - 4) top = Math.max(4, r.top - h - 6);
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  chip.style.top = `${top}px`;
  chip.style.left = `${left}px`;
}

function hide() {
  closeSiteMenu();
  if (chip) chip.hidden = true;
  current = null;
}

function dismiss() {
  if (current) dismissed = { el: current.el, text: readEditable(current.el).text };
  hide();
}

function update(el: Editable) {
  const code = codeInEditable(el);
  if (!code || (dismissed?.el === el && dismissed.text === readEditable(el).text)) return hide();
  chip ??= build();
  if (current && formatCode(current.code) !== formatCode(code)) closeSiteMenu();
  current = { el, code };
  label.textContent = formatCode(code);
  paintStar();
  chip.hidden = false;
  position();
}

function targetOf(e: Event): Editable | null {
  const el = editableFrom(e.composedPath()[0]);
  // Not the extension's own boxes (the CC menu's code box), which have their own buttons.
  return el && !el.closest(`[${UI_ATTR}]`) ? el : null;
}

const onInput = (e: Event) => {
  const el = targetOf(e);
  if (!el) return;
  clearTimeout(inputTimer);
  inputTimer = window.setTimeout(() => update(el), 120);
};

const onFocusIn = (e: Event) => {
  clearTimeout(blurTimer);
  const el = targetOf(e);
  if (el) update(el);
};

const onFocusOut = () => {
  // Delay so moving focus between parts of the same editor doesn't flicker.
  blurTimer = window.setTimeout(() => {
    if (current && !current.el.contains(document.activeElement) && current.el !== document.activeElement) hide();
  }, 150);
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && current && !chip?.hidden) dismiss();
};

// Caret moves (arrows, clicks) can change which code is nearest.
const onCaretMove = (e: Event) => {
  const el = targetOf(e);
  if (el && current?.el === el) update(el);
};

const onViewportChange = () => position();

export function enableFieldChip() {
  if (!watchingStars) {
    watchingStars = true;
    onStarredChange(paintStar);
  }
  document.addEventListener('input', onInput, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onCaretMove, true);
  document.addEventListener('click', onCaretMove, true);
  window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewportChange, { passive: true });
  // A field may already be focused (e.g. autofocus search box).
  const focused = editableFrom(document.activeElement);
  if (focused) update(focused);
}

export function disableFieldChip() {
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('keyup', onCaretMove, true);
  document.removeEventListener('click', onCaretMove, true);
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
  hide();
}
