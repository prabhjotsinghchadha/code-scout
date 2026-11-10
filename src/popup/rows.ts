// What the popup's lists are made of: a row opens with one click on its name (a round glyph, then the
// name), and its other actions are small icon buttons after it.
import { icon, type IconName } from '../shared/icons';

/** A square icon button; `label` is its tooltip and accessible name. */
export function iconButton(name: IconName, label: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn ${className}`.trim();
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The part of a row that opens it: `glyph` in a circle, then `label`. `kind` colours the circle ("heart",
 * "hash", "plain"; rose by default). The arrow keys move between these (see main.ts).
 */
export function rowMain(glyph: (Node | string)[], label: HTMLElement, title: string, onClick: () => void, kind = '') {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'row-main', title });
  const go = Object.assign(document.createElement('span'), { className: `row-go ${kind}`.trim() });
  go.setAttribute('aria-hidden', 'true');
  go.append(...glyph);
  b.append(go, label);
  b.addEventListener('click', onClick);
  return b;
}

/** The icon buttons after a row's name. */
export function rowActions(...buttons: HTMLElement[]) {
  const box = Object.assign(document.createElement('span'), { className: 'row-actions' });
  box.append(...buttons);
  return box;
}
