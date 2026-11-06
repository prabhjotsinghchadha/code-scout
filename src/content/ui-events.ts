// The extension's own on-page UI (▶ buttons, chip, sites menu) gets its input through the
// click shield (shield.iife.ts): real events are stopped before page scripts see them and
// re-delivered as "javtr:<type>" custom events. Elements must be marked with markUi().

export const UI_ATTR = 'data-javtr-ui';

export interface UiEventDetail {
  button?: number;
  key?: string;
  shiftKey?: boolean;
}

export function markUi<T extends HTMLElement>(el: T): T {
  el.setAttribute(UI_ATTR, '');
  return el;
}

export function onUi(
  el: EventTarget,
  type: 'click' | 'contextmenu' | 'keydown' | 'mousedown',
  handler: (detail: UiEventDetail) => void,
) {
  el.addEventListener(`javtr:${type}`, (e) => handler((e as CustomEvent<UiEventDetail>).detail ?? {}));
}

/** A button for the video toolbar and its menus (inside a markUi element). */
export function button(className: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.title = title;
  return b;
}

/** Click or Enter/Space (the shield cancels the key's default, so no click follows it). */
export function onActivate(el: HTMLElement, action: () => void) {
  onUi(el, 'click', ({ button }) => button === 0 && action());
  onUi(el, 'keydown', ({ key }) => (key === 'Enter' || key === ' ') && action());
}
