// The link last right-clicked on the page, for "Add this actress to favourites" and "Open trailer for this
// link": the right-click menu tells the background a link's address but not its text (her name, a title
// with the code in it).
import type { ContextLink } from '../shared/messages';

let last: ContextLink | null = null;

/** A link's visible text, else its image's alt text, else its title. */
function linkText(a: HTMLAnchorElement): string {
  return a.innerText.trim() || a.querySelector('img[alt]')?.getAttribute('alt')?.trim() || a.title.trim();
}

/**
 * Text of the card a link is in: the nearest of its parents with more text than the link (a thumbnail
 * link whose own text is just the video's length has the title beside it). Not a whole list of them.
 */
function cardText(a: HTMLAnchorElement, own: string): string {
  let el = a.parentElement;
  for (let up = 0; el && el !== document.body && up < 4; up++, el = el.parentElement) {
    const text = el.innerText.trim();
    if (text.length > 400) break;
    if (text.length > own.length) return text;
  }
  return '';
}

/** Starts remembering right-clicked links (capture phase, so the page can't hide the click from us). */
export function watchContextLinks(): void {
  window.addEventListener(
    'contextmenu',
    (e) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!a) {
        last = null;
        return;
      }
      const text = linkText(a);
      last = { url: a.href, text, around: cardText(a, text) };
    },
    true,
  );
}

export function lastContextLink(): ContextLink | null {
  return last;
}
