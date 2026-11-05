// Click shield. Runs at document_start, before any page script, so its window-level
// capture listeners fire first for every event. Events on the extension's own UI
// (elements marked data-javtr-ui) are stopped right there, so page scripts such as
// pop-under ads never see them, and re-delivered to the extension as "javtr:<type>"
// custom events. Built as an IIFE (*.iife.ts) so it registers synchronously.
declare global {
  interface Window {
    __javtrShield?: boolean;
  }
}

(() => {
  if (window.__javtrShield) return;
  window.__javtrShield = true;

  const EVENTS = [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick',
    'contextmenu', 'touchstart', 'touchend', 'keydown', 'keyup',
  ];
  // Default actions to cancel: following a link the ▶ sits in, the native context menu,
  // and focus moving out of a text field when the chip is clicked.
  const PREVENT_DEFAULT = new Set(['mousedown', 'click', 'auxclick', 'dblclick', 'contextmenu']);

  const ownUi = (e: Event) => {
    for (const node of e.composedPath()) {
      if (node instanceof Element && node.hasAttribute('data-javtr-ui')) return true;
    }
    return false;
  };

  for (const type of EVENTS) {
    window.addEventListener(
      type,
      (e: Event) => {
        if (!ownUi(e)) return;
        e.stopImmediatePropagation();
        const activationKey = type === 'keydown' && ['Enter', ' '].includes((e as KeyboardEvent).key);
        if ((PREVENT_DEFAULT.has(type) || activationKey) && e.cancelable) e.preventDefault();
        const target = e.composedPath()[0];
        target.dispatchEvent(
          new CustomEvent(`javtr:${type}`, {
            bubbles: true,
            detail: {
              button: (e as MouseEvent).button,
              key: (e as KeyboardEvent).key,
              shiftKey: (e as MouseEvent).shiftKey,
            },
          }),
        );
      },
      true,
    );
  }
})();

export {};
