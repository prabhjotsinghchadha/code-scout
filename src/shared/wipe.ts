// "Close what I'm watching" and "Clear watch history" (background/wipe.ts): which tabs and which of the
// browser's history entries are the user's video sites'. Stricter than hiding (shared/hide.ts): a tab
// hidden by mistake comes back, a closed tab or a deleted history entry doesn't.
import { baseDomain, siteKey } from './hosts.ts';
import { watchSites } from './hide.ts';
import { videoPageCode, type Seen } from './seen.ts';

/**
 * The user's sites (see watchSites) plus the sites of the pages their seen codes were watched on, which
 * needn't be among the quick links. Base domains.
 */
export function wipeSites(settings: Parameters<typeof watchSites>[0], seen: Seen = {}): string[] {
  const sites = new Set(watchSites(settings));
  for (const { url } of Object.values(seen)) {
    const key = url ? siteKey(url) : null;
    if (key) sites.add(baseDomain(key));
  }
  return [...sites];
}

/** True for a page on one of `sites` (or a subdomain), or a video page by its address on any site. */
export function isWatchUrl(url: string | undefined, sites: string[]): boolean {
  const host = url ? siteKey(url) : null;
  if (!url || !host) return false; // chrome:// pages, the new tab page
  return sites.includes(baseDomain(host)) || !!videoPageCode(url);
}
