// "Most visited": how often each quick-link site is visited, kept in chrome.storage.local (this computer
// only). Each site has a score that halves every two weeks without visits, so sites used lately rank first.
import { baseDomain } from './hosts.ts';
import type { QuickLink } from './quick-links.ts';

export interface SiteVisits {
  /** Visits, each counting less as time passes (see HALF_LIFE_MS). */
  score: number;
  /** When `score` was last updated (ms since epoch). */
  at: number;
}

/** "missav.ws" → its visits. */
export type Visits = Record<string, SiteVisits>;

export const VISITS_KEY = 'siteVisits';
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
/** Below this a site is forgotten (about two months after a single visit). */
const FORGET_BELOW = 0.05;
/** A site needs about this many recent visits to show as most visited. */
const SHOW_FROM = 1;

/** The site a URL belongs to, for counting: "missav.ws" for https://www.missav.ws/… and m.missav.ws. */
export function siteOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? baseDomain(hostname) : null;
  } catch {
    return null;
  }
}

export function scoreNow(v: SiteVisits, now: number): number {
  return v.score * 0.5 ** (Math.max(0, now - v.at) / HALF_LIFE_MS);
}

/** Counts one visit to `site`, and drops sites not visited for a long time. */
export function addVisit(visits: Visits, site: string, now: number): Visits {
  const next: Visits = {};
  for (const [s, v] of Object.entries(visits)) {
    const score = scoreNow(v, now);
    if (score >= FORGET_BELOW) next[s] = { score, at: now };
  }
  next[site] = { score: (next[site]?.score ?? 0) + 1, at: now };
  return next;
}

/**
 * Up to `n` quick links on the sites visited most, one per site (the site's first link in the list), most
 * visited first.
 */
export function mostVisitedLinks(links: QuickLink[], visits: Visits, now: number, n = 4): QuickLink[] {
  const bySite = new Map<string, QuickLink>();
  for (const link of links) {
    const site = siteOf(link.url);
    if (site && !bySite.has(site)) bySite.set(site, link);
  }
  return [...bySite]
    .map(([site, link]) => ({ link, score: visits[site] ? scoreNow(visits[site], now) : 0 }))
    .filter((x) => x.score >= SHOW_FROM)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.link);
}
