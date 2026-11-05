// The popup's Recent tab: codes already seen (shared/seen.ts), the most recent first, each with when, the
// page it was seen on and a button to forget it.
import { formatCode, type VideoCode } from '../shared/codes';
import type { FavouritePage } from '../shared/favourites';
import { icon } from '../shared/icons';
import { forgetSeenCode, getSeen, onSeenChanged, recentSeen, seenAgo, type Seen, type SeenCode } from '../shared/seen';

/** Rows shown at most; the filter searches every seen code. */
const SHOW = 100;
/** The filter shows from this many seen codes up. */
const FILTER_FROM = 8;

export interface RecentOptions {
  /** A code's row (Open, Search, Sites, ☆); `page` is saved with it if it's starred. */
  row: (code: VideoCode, page: FavouritePage | null) => HTMLLIElement;
  /** A link to a page, opened next to this tab. */
  pageLink: (url: string, title?: string) => HTMLElement;
  /** Called with the seen codes now and whenever they change (for the ✓ in the other lists). */
  onChange: (seen: Seen) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Lower case, without spaces and dashes, so "nsfs484" finds "NSFS-484". */
const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

export async function setupRecent({ row, pageLink, onChange }: RecentOptions): Promise<void> {
  const list = $<HTMLUListElement>('recent');
  const filter = $<HTMLInputElement>('recent-filter');
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
    const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn forget', title: label });
    forget.setAttribute('aria-label', label);
    forget.append(icon('x', 13));
    forget.addEventListener('click', () => void forgetSeenCode(s.code));
    meta.append(forget);
    li.append(meta);
    return li;
  };

  const paint = () => {
    const all = recentSeen(seen);
    const query = squash(filter.value);
    const matches = query
      ? all.filter((s) => [formatCode(s.code), s.title ?? '', s.url ?? ''].some((t) => squash(t).includes(query)))
      : all;
    const shown = matches.slice(0, SHOW);
    filter.hidden = all.length < FILTER_FROM && !filter.value;
    list.replaceChildren(...shown.map(recentRow));
    $('recent-empty').hidden = all.length > 0;
    $('recent-none').hidden = !all.length || matches.length > 0;
    const more = $('recent-more');
    more.hidden = matches.length <= SHOW;
    more.textContent = `The ${SHOW} most recent of ${matches.length.toLocaleString()}. Filter to find the others.`;
  };

  filter.addEventListener('input', paint);
  onSeenChanged((next) => {
    seen = next;
    paint();
    onChange(seen);
  });
  paint();
  onChange(seen);
}
