// How the popup's lists are sorted: the choices each list offers, the sorting itself (pure, unit-tested),
// and the choice last made for each list (a per-browser convenience, kept in localStorage like the last tab).
import { formatCode, type VideoCode } from '../shared/codes.ts';
import type { QuickLink } from '../shared/quick-links.ts';
import { linkLabel } from '../shared/quick-links.ts';
import { scoreNow, siteOf, type Visits } from '../shared/visits.ts';

export interface SortChoice<T extends string> {
  value: T;
  label: string;
}

export const PAGE_SORTS = [
  { value: 'order', label: 'Page order' },
  { value: 'unseen', label: 'Unseen first' },
  { value: 'code', label: 'Code A–Z' },
] as const satisfies readonly SortChoice<string>[];
export const TIME_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'code', label: 'Code A–Z' },
] as const satisfies readonly SortChoice<string>[];
export const NAME_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'az', label: 'A–Z' },
] as const satisfies readonly SortChoice<string>[];
export const LINK_SORTS = [
  { value: 'mine', label: 'My order' },
  { value: 'visited', label: 'Most visited' },
  { value: 'az', label: 'A–Z' },
] as const satisfies readonly SortChoice<string>[];

export type PageSort = (typeof PAGE_SORTS)[number]['value'];
export type TimeSort = (typeof TIME_SORTS)[number]['value'];
export type NameSort = (typeof NAME_SORTS)[number]['value'];
export type LinkSort = (typeof LINK_SORTS)[number]['value'];

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const codeText = (code: VideoCode | undefined) => (code ? formatCode(code) : '');

/** The page's codes: as the page has them, the ones not seen yet first (each part in page order), or A–Z. */
export function sortPageCodes(codes: VideoCode[], by: PageSort, isSeen: (code: VideoCode) => boolean): VideoCode[] {
  if (by === 'code') return [...codes].sort((a, b) => byText(formatCode(a), formatCode(b)));
  if (by === 'unseen') return [...codes.filter((c) => !isSeen(c)), ...codes.filter(isSeen)];
  return codes;
}

/**
 * Things with a time (favourites by when they were starred, seen codes by when they were seen) and maybe a
 * code. A–Z puts the ones without a code (a starred page) last, newest first among themselves.
 */
export function sortByTime<T>(items: T[], by: TimeSort, time: (item: T) => number, code: (item: T) => VideoCode | undefined): T[] {
  const newest = (a: T, b: T) => time(b) - time(a);
  if (by === 'oldest') return [...items].sort((a, b) => time(a) - time(b));
  if (by === 'code') {
    return [...items].sort((a, b) => {
      const [ca, cb] = [codeText(code(a)), codeText(code(b))];
      if (!ca || !cb) return ca ? -1 : cb ? 1 : newest(a, b);
      return byText(ca, cb);
    });
  }
  return [...items].sort(newest);
}

/** Favourite actresses and tags: newest first, or by name. */
export function sortByName<T extends { name: string; added: number }>(items: T[], by: NameSort): T[] {
  return [...items].sort(by === 'az' ? (a, b) => byText(a.name, b.name) : (a, b) => b.added - a.added);
}

/** A group's links: as arranged, the most visited sites first (the rest stay in their order), or by name. */
export function sortLinks(links: QuickLink[], by: LinkSort, visits: Visits, now: number): QuickLink[] {
  if (by === 'az') return [...links].sort((a, b) => byText(linkLabel(a).title, linkLabel(b).title) || byText(a.name, b.name));
  if (by === 'visited') {
    const score = (link: QuickLink) => {
      const site = siteOf(link.url);
      return site && visits[site] ? scoreNow(visits[site], now) : 0;
    };
    // Array.prototype.sort is stable: links of sites visited equally keep the user's order.
    return [...links].sort((a, b) => score(b) - score(a));
  }
  return links;
}

/** The day a time falls on, as a heading: "Today", "Yesterday", "Monday" (this past week), "9 November", "9 November 2025". */
export function dayLabel(at: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(at);
  if (days < 7) return date.toLocaleDateString('en-GB', { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(!sameYear && { year: 'numeric' }) });
}

/** The sort last picked for a list ("page", "favs-videos", "links"…), if it's still one of its choices. */
export function storedSort<T extends string>(list: string, choices: readonly SortChoice<T>[]): T {
  try {
    const stored = localStorage.getItem(`sort:${list}`);
    const found = choices.find((c) => c.value === stored);
    if (found) return found.value;
  } catch {
    // Storage unavailable: the first choice.
  }
  return choices[0].value;
}

export function storeSort(list: string, value: string) {
  try {
    localStorage.setItem(`sort:${list}`, value);
  } catch {
    // Not remembered, that's all.
  }
}
