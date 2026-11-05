// The link last right-clicked on the page, for "Add this actress to favourites": the right-click menu
// tells the background a link's address but not its text, which is her name.
import type { ContextLink } from '../shared/messages';

let last: ContextLink | null = null;

/** A link's visible text, else its image's alt text, else its title. */
function linkText(a: HTMLAnchorElement): string {
  return a.innerText.trim() || a.querySelector('img[alt]')?.getAttribute('alt')?.trim() || a.title.trim();
}

/** Starts remembering right-clicked links (capture phase, so the page can't hide the click from us). */
export function watchContextLinks(): void {
  window.addEventListener(
    'contextmenu',
    (e) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      last = a ? { url: a.href, text: linkText(a) } : null;
    },
    true,
  );
}

export function lastContextLink(): ContextLink | null {
  return last;
}
