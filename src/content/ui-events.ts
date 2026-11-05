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
