// Offering the built-in sites, pages and groups (sites.ts) to a user: each item once, on install or
// on the first update that has it. The keys of what was offered are recorded (in sync, see storage.ts),
// so anything the user removed, renamed or regrouped afterwards stays that way. Pure; storage.ts runs it.
import type { OpenOnSite } from './open-on.ts';
import { hasGroup, type QuickLink } from './quick-links.ts';
import { GROUP_AUDIENCE, GROUPS, SITES, type Site } from './sites.ts';

export interface SeedState {
  quickLinks: QuickLink[];
  linkGroups: string[];
  openOnSites: OpenOnSite[];
}

/** Who a built-in is for: a new install only, or installs from before there were starting points. */
export type Audience = 'new' | 'earlier';

export interface BuiltInLink extends QuickLink {
  key: string;
  /** Offered to these installs only (its group's audience, see GROUP_AUDIENCE); to all when not set. */
  audience?: Audience;
  /** Key for moving the user's own ungrouped copy of this link into its group (set when it has one). */
  groupKey?: string;
}

/** Built-in items with the keys installs remember them by. */
export interface BuiltIns {
  groups: { key: string; name: string; audience?: Audience }[];
  links: BuiltInLink[];
  sites: (OpenOnSite & { key: string })[];
}

export function builtInsFrom(sites: Site[], groups: string[]): BuiltIns {
  return {
    groups: groups.map((name) => ({ key: `group:${name}`, name, ...(GROUP_AUDIENCE[name] && { audience: GROUP_AUDIENCE[name] }) })),
    links: sites.flatMap((site) =>
      (site.pages ?? []).map((page) => {
        const key = `link:${site.id}/${page.id}`;
        return {
          key,
          name: page.label ? `${site.name} · ${page.label}` : site.name,
          url: new URL(page.path, site.origin).href,
          ...(page.group && { group: page.group, groupKey: `${key}@${page.group}` }),
          ...(page.group && GROUP_AUDIENCE[page.group] && { audience: GROUP_AUDIENCE[page.group] }),
        };
      }),
    ),
    sites: sites.flatMap((site) =>
      // Concatenated, not new URL(): that would percent-encode the {placeholder} braces.
      site.openOn ? [{ key: `site:${site.id}`, id: site.id, name: site.name, template: site.origin + site.openOn }] : [],
    ),
  };
}

export const BUILT_INS = builtInsFrom(SITES, GROUPS);

export function builtInKeys({ groups, links, sites }: BuiltIns): string[] {
  return [
    ...groups.map((g) => g.key),
    ...links.flatMap((l) => (l.groupKey ? [l.key, l.groupKey] : [l.key])),
    ...sites.map((s) => s.key),
  ];
}

/**
 * Adds the built-ins whose keys aren't in `offered`: groups the user doesn't have, links whose URL they
 * don't have, "Open on" sites they don't have (same id or URL pattern). A link they already have
 * ungrouped is moved into its built-in group, once. Returns null when there's nothing new to offer.
 *
 * `fresh`: this install has never been offered anything. It gets the built-ins for new installs ("Start
 * here") and not the ones for earlier installs; any other install, the reverse. Either way every key is
 * recorded as offered, so a built-in that wasn't for this install is never added to it later.
 */
export function seed(
  state: SeedState,
  offered: Iterable<string>,
  builtIns: BuiltIns = BUILT_INS,
  fresh = false,
): { state: SeedState; offered: string[] } | null {
  const done = new Set(offered);
  const keys = builtInKeys(builtIns);
  if (keys.every((k) => done.has(k))) return null;
  const isNew = (key: string) => !done.has(key);
  const forUs = (item: { audience?: Audience }) => !item.audience || item.audience === (fresh ? 'new' : 'earlier');
  builtIns = { ...builtIns, groups: builtIns.groups.filter(forUs), links: builtIns.links.filter(forUs) };

  const linkGroups = [
    ...state.linkGroups,
    ...builtIns.groups.filter((g) => isNew(g.key) && !hasGroup(state.linkGroups, g.name)).map((g) => g.name),
  ];
  let quickLinks = state.quickLinks.map((l) => {
    const built = !l.group && builtIns.links.find((b) => b.url === l.url);
    return built && built.groupKey && isNew(built.groupKey) ? { ...l, group: built.group } : l;
  });
  const added = builtIns.links.filter((b) => isNew(b.key) && !quickLinks.some((l) => l.url === b.url));
  quickLinks = [...quickLinks, ...added.map(({ name, url, group }) => ({ name, url, ...(group && { group }) }))];
  const openOnSites = [
    ...state.openOnSites,
    ...builtIns.sites
      .filter((b) => isNew(b.key) && !state.openOnSites.some((x) => x.id === b.id || x.template === b.template))
      .map(({ id, name, template }) => ({ id, name, template })),
  ];

  return { state: { quickLinks, linkGroups, openOnSites }, offered: [...new Set([...done, ...keys])] };
}

/**
 * Installs from before keys stored a single seed version (chrome.storage.local "quickLinksSeedVersion").
 * These are the items each version had offered, so those installs aren't offered them a second time.
 * Frozen: items added after the switch to keys never go here.
 */
const OFFERED_BY_VERSION: Record<number, string[]> = {
  1: ['link:missav/english-subtitle', 'link:javmost/cuckold', 'link:javtiful/affair'],
  2: ['group:Cheating', 'group:Cuckold', 'group:NTR', 'link:javmost/cuckold@Cuckold', 'link:javtiful/affair@Cheating'],
  3: [
    'link:javlibrary/most-wanted',
    'link:javtrailers/cheating-wife',
    'link:javtrailers/cheating-wife@Cheating',
    'link:javtrailers/adultery',
    'link:javtrailers/adultery@Cheating',
  ],
  4: ['link:beeg/cuckold-japanese', 'link:beeg/cuckold-japanese@Cuckold'],
  5: [
    'group:All Japanese',
    'link:faphouse/japanese',
    'link:faphouse/japanese@All Japanese',
    'link:pornhub/japanese',
    'link:pornhub/japanese@All Japanese',
    'link:youporn/japanese',
    'link:youporn/japanese@All Japanese',
  ],
  6: ['site:missav', 'site:javlibrary', 'site:javmost', 'site:javtiful', 'site:javguru'],
  7: ['link:javguru/english-subbed'],
  8: ['link:18jav/chinese-subtitle'],
  9: ['link:jable/home', 'site:jable'],
  10: [
    'group:Subtitles',
    'group:More sites',
    'link:missav/english-subtitle@Subtitles',
    'link:javguru/english-subbed@Subtitles',
    'link:18jav/chinese-subtitle@Subtitles',
    'link:jable/home@More sites',
    'link:supjav/english-subtitles',
    'link:supjav/english-subtitles@Subtitles',
    'link:bestjavporn/english-subtitle',
    'link:bestjavporn/english-subtitle@Subtitles',
    'link:sextb/home',
    'link:sextb/home@More sites',
    'link:7mmtv/home',
    'link:7mmtv/home@More sites',
    'link:koreanpornmovie/home',
    'link:koreanpornmovie/home@More sites',
    'link:theporndude/home',
    'link:theporndude/home@More sites',
    'site:supjav',
    'site:bestjavporn',
    'site:sextb',
  ],
};

/** Keys of everything an install on the old seed `version` had been offered. */
export function offeredByVersion(version: number): string[] {
  return Object.entries(OFFERED_BY_VERSION).flatMap(([v, keys]) => (Number(v) <= version ? keys : []));
}

/** Every key in the frozen table, for checking it against the registry. */
export const LEGACY_KEYS = Object.values(OFFERED_BY_VERSION).flat();
