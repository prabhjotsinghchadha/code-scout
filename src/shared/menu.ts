// A small pop-up menu for the extension's own pages (popup, Settings): opened from a ⋯ button or a
// right-click, closed by choosing, Esc, clicking elsewhere or scrolling.
import { icon, type IconName } from './icons.ts';

export type MenuItem =
  | { label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { heading: string }
  | 'separator';

let open: { el: HTMLElement; close: () => void } | null = null;

export function closeMenu() {
  open?.close();
}

/** Shows the menu under `at` (an element's box) or at a point (a right-click). */
export function openMenu(at: DOMRect | { x: number; y: number }, items: MenuItem[], opener?: HTMLElement) {
  closeMenu();
  const el = Object.assign(document.createElement('div'), { className: 'menu' });
  el.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'separator') {
      el.append(Object.assign(document.createElement('hr'), { className: 'menu-sep' }));
    } else if ('heading' in item) {
      el.append(Object.assign(document.createElement('div'), { className: 'menu-heading', textContent: item.heading }));
    } else {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: `menu-item${item.danger ? ' danger' : ''}`,
        disabled: !!item.disabled,
      });
      b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
      if (item.checked !== undefined) b.setAttribute('aria-checked', String(item.checked));
      b.append(item.checked ? icon('check', 14) : item.icon ? icon(item.icon, 14) : document.createElement('span'));
      b.append(item.label);
      b.addEventListener('click', () => {
        close();
        item.onClick();
      });
      el.append(b);
    }
  }

  el.style.visibility = 'hidden';
  document.body.append(el);
  const { offsetWidth: w, offsetHeight: h } = el;
  const box = 'width' in at ? at : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  let top = box.bottom + 4;
  if (top + h > innerHeight - 6) top = Math.max(6, box.top - h - 4);
  const left = Math.max(6, Math.min('width' in at ? box.right - w : box.left, innerWidth - w - 6));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = '';

  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)')];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      opener?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = buttons();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    }
  };
  const onOutside = (e: Event) => {
    if (!e.composedPath().includes(el)) close();
  };
  function close() {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('blur', close);
    if (open?.el === el) open = null;
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('scroll', close, { capture: true, passive: true });
  window.addEventListener('blur', close);
  open = { el, close };
  buttons()[0]?.focus();
}
