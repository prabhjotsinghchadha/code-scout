// The popup's Recent tab: codes already seen (shared/seen.ts), the most recent first, each with when, the
// page it was seen on and a button to forget it.
import { formatCode, type VideoCode } from '../shared/codes';
import type { FavouritePage } from '../shared/favourites';
import { icon } from '../shared/icons';
import { forgetSeenCode, getSeen, onSeenChanged, recentSeen, seenAgo, type Seen, type SeenCode } from '../shared/seen';

/** Rows shown at most; the box at the top of the popup searches every seen code. */
const SHOW = 100;

export interface RecentOptions {
  /** A code's row (Open, Search, Sites, ☆); `page` is saved with it if it's starred. */
  row: (code: VideoCode, page: FavouritePage | null) => HTMLLIElement;
  /** A link to a page, opened next to this tab. */
  pageLink: (url: string, title?: string) => HTMLElement;
  /** Called with the seen codes now and whenever they change (for the ✓ in the other lists). */
  onChange: (seen: Seen) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function setupRecent({ row, pageLink, onChange }: RecentOptions): Promise<void> {
  const list = $<HTMLUListElement>('recent');
  let seen = await getSeen();

  const recentRow = (s: SeenCode) => {
    const li = row(s.code, s.url ? { url: s.url, title: s.title } : null);
    li.classList.add('seen-row');
    const meta = Object.assign(document.createElement('div'), { className: 'seen-meta' });
    const when = Object.assign(document.createElement('span'), {
      className: 'when',
      textContent: seenAgo(s.at, Date.now()),
      title: new Date(s.at).toLocaleString(),
    });
    meta.append(when);
    if (s.url) meta.append(pageLink(s.url, s.title));
    const label = `Forget that you’ve seen ${formatCode(s.code)}`;
    const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn forget quiet', title: label });
    forget.setAttribute('aria-label', label);
    forget.append(icon('x', 13));
    forget.addEventListener('click', () => void forgetSeenCode(s.code));
    meta.append(forget);
    li.append(meta);
    return li;
  };

  const paint = () => {
    const all = recentSeen(seen);
    list.replaceChildren(...all.slice(0, SHOW).map(recentRow));
    $('recent-empty').hidden = all.length > 0;
    const more = $('recent-more');
    more.hidden = all.length <= SHOW;
    more.textContent = `The ${SHOW} most recent of ${all.length.toLocaleString()}. Search above to find the others.`;
  };

  onSeenChanged((next) => {
    seen = next;
    paint();
    onChange(seen);
  });
  paint();
  onChange(seen);
}
