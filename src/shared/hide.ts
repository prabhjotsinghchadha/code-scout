// "Hide what I'm watching" (background/hide.ts): which tabs count as being watched.
import { findCodes } from './codes.ts';
import { baseDomain, siteKey } from './hosts.ts';
import type { OpenOnSite } from './open-on.ts';
import type { QuickLink } from './quick-links.ts';
import { videoPageCode } from './seen.ts';

/** What's known of a tab (chrome.tabs.Tab has these). */
export interface TabLike {
  url?: string;
  title?: string;
  audible?: boolean;
}

/**
 * The user's sites: javtrailers.com, the quick links', the "Open on" sites' and those with the pop-up
 * blocker on. Base domains ("missav.ws"), so a site's other subdomains count too.
 */
export function watchSites(settings: { quickLinks: QuickLink[]; openOnSites: OpenOnSite[]; popupBlockSites: string[] }): string[] {
  const urls = [
    'javtrailers.com',
    ...settings.quickLinks.map((l) => l.url),
    // The placeholder is never in the host; without it the address parses as it is.
    ...settings.openOnSites.map((s) => s.template.replace(/\{\w+\}/g, 'x')),
    ...settings.popupBlockSites,
  ];
  const sites = new Set<string>();
  for (const url of urls) {
    const key = siteKey(url);
    if (key) sites.add(baseDomain(key));
  }
  return [...sites];
}

/**
 * True for a tab to hide: on one of `sites`, playing sound, or a video page by its address or title (a
 * code in it). Leans towards hiding: a tab hidden by mistake comes back, one left in view doesn't.
 */
export function isWatchTab(tab: TabLike, sites: string[]): boolean {
  const host = tab.url ? siteKey(tab.url) : null;
  if (!tab.url || !host) return false; // chrome:// pages, the new tab page
  return (
    sites.includes(baseDomain(host)) ||
    !!tab.audible ||
    !!videoPageCode(tab.url) ||
    findCodes(tab.title ?? '').length > 0
  );
}
