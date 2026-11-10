// The popup's Recent tab: codes already seen (shared/seen.ts), the most recent first, each with when, the
// page it was seen on and a button to forget it.
import { formatCode, type VideoCode } from '../shared/codes';
import type { FavouritePage } from '../shared/favourites';
import { icon } from '../shared/icons';
import { forgetSeenCode, getSeen, onSeenChanged, recentSeen, seenAgo, type Seen, type SeenCode } from '../shared/seen';
import { allDetails } from './details';
import { matchesFacet, type Facet } from './filter';
import { filterButton, sortButton } from './rows';
import { dayLabel, sortByTime, storedSort, storeSort, TIME_SORTS, type TimeSort } from './sort';

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
  let sort: TimeSort = storedSort('recent', TIME_SORTS);
  /** Narrowed to one label, performer or studio (null: everything). Not kept between openings. */
  let facet: Facet | null = null;

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
    const everything = recentSeen(seen);
    const kept = facet ? everything.filter((s) => matchesFacet(s.code, facet!, allDetails())) : everything;
    const all = sortByTime(kept, sort, (s) => s.at, (s) => s.code);
    // By time, the list is in days: a heading where each day starts.
    const rows: HTMLElement[] = [];
    let day = '';
    const now = Date.now();
    for (const s of all.slice(0, SHOW)) {
      const label = sort === 'code' ? '' : dayLabel(s.at, now);
      if (label !== day) {
        day = label;
        rows.push(Object.assign(document.createElement('li'), { className: 'day-head', textContent: label }));
      }
      rows.push(recentRow(s));
    }
    list.replaceChildren(...rows);
    $('recent-empty').hidden = everything.length > 0;
    $('recent-head').hidden = everything.length < 2; // nothing to sort or narrow
    $('recent-title').textContent = facet
      ? `${all.length.toLocaleString()} of ${everything.length.toLocaleString()}`
      : `${everything.length.toLocaleString()} videos seen`;
    const more = $('recent-more');
    more.hidden = all.length <= SHOW;
    more.textContent = `The first ${SHOW} of ${all.length.toLocaleString()}. Search above to find the others.`;
  };
  filterButton(
    $<HTMLButtonElement>('recent-filter'),
    $<HTMLButtonElement>('recent-facet'),
    () => recentSeen(seen).map((s) => s.code),
    allDetails,
    () => facet,
    (next) => {
      facet = next;
      paint();
    },
  );
  sortButton($<HTMLButtonElement>('recent-sort'), TIME_SORTS, () => sort, (value) => {
    sort = value;
    storeSort('recent', value);
    paint();
  });

  onSeenChanged((next) => {
    seen = next;
    paint();
    onChange(seen);
  });
  paint();
  onChange(seen);
}
