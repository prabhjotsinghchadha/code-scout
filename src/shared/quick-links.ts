// Pure helpers for quick links and their groups (no chrome APIs, so they're unit-testable).
import { baseDomain } from './hosts.ts';

export interface QuickLink {
  name: string;
  url: string;
  /** Group name, e.g. "Cuckold". Missing (or a group that no longer exists) = ungrouped. */
  group?: string;
}

export interface LinkState {
  quickLinks: QuickLink[];
  /** Group names in display order. */
  linkGroups: string[];
}

export interface LinkSection {
  /** null = links without a group (shown first, without a heading). */
  group: string | null;
  links: QuickLink[];
}

export const MAX_GROUP_NAME = 30;

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function hasGroup(groups: string[], name: string): boolean {
  return groups.some((g) => same(g, name));
}

/** Ungrouped links first, then one section per group in order (empty groups included). */
export function groupLinks({ quickLinks, linkGroups }: LinkState): LinkSection[] {
  const ungrouped = quickLinks.filter((l) => !l.group || !hasGroup(linkGroups, l.group));
  return [
    { group: null, links: ungrouped },
    ...linkGroups.map((g) => ({ group: g, links: quickLinks.filter((l) => l.group && same(l.group, g)) })),
  ];
}

/** Returns an error message, or null if `name` can be used as a new group name. */
export function validateGroupName(groups: string[], name: string, except?: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a group name.';
  if (n.length > MAX_GROUP_NAME) return `Keep group names under ${MAX_GROUP_NAME} characters.`;
  const existing = groups.find((g) => g !== except && same(g, n));
  if (existing) return `There’s already a group called “${existing}”.`;
  return null;
}

export function addGroup(state: LinkState, name: string): LinkState {
  return { ...state, linkGroups: [...state.linkGroups, name.trim()] };
}

export function renameGroup(state: LinkState, from: string, to: string): LinkState {
  const name = to.trim();
  return {
    linkGroups: state.linkGroups.map((g) => (g === from ? name : g)),
    quickLinks: state.quickLinks.map((l) => (l.group && same(l.group, from) ? { ...l, group: name } : l)),
  };
}

/** Deletes the group; its links stay, ungrouped. */
export function deleteGroup(state: LinkState, name: string): LinkState {
  return {
    linkGroups: state.linkGroups.filter((g) => g !== name),
    quickLinks: state.quickLinks.map((l) => {
      if (!l.group || !same(l.group, name)) return l;
      const { group: _removed, ...rest } = l;
      return rest;
    }),
  };
}

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Sets (or clears, with null) the group of the link with this URL. */
export function setLinkGroup(links: QuickLink[], url: string, group: string | null): QuickLink[] {
  return links.map((l) => {
    if (l.url !== url) return l;
    const { group: _old, ...rest } = l;
    return group ? { ...rest, group } : rest;
  });
}

/**
 * What a link shows: the page's name and the site it's on. Built-in links are named "MissAV · English
 * subtitle", so the part after the dot is the page; the site underneath is the address's host.
 */
export function linkLabel({ name, url }: QuickLink): { title: string; host: string } {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Keep the address as it is.
  }
  const dot = name.indexOf(' · ');
  return { title: (dot > 0 ? name.slice(dot + 3) : name).trim() || host, host };
}

const SITE_DOT = ' · ';
export const MAX_PAGE_NAME = 60;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};
/** Lower case letters and digits only, so "Jav Guru", "JAV GURU" and "jav.guru" compare equal. */
const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** "English subbed" from ".../category/english-subbed/"; "" for a site's home page. */
function pathName(url: string): string {
  let last = '';
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return '';
  }
  const words = last.replace(/\.[a-z\d]+$/i, '').replace(/[-_+]+/g, ' ').trim();
  return words && words[0].toUpperCase() + words.slice(1);
}

/**
 * A name for a page being saved, in the "Site · Page" form the built-in links use ("Jav Guru · English
 * subbed"), so its tile shows the page's name over the site's address. The site's name comes from a link
 * already saved on that site, else a built-in site, else the part of the page title that matches the
 * address, else the address itself; the page's name is the rest of the title (or the address's last part).
 */
export function suggestLinkName(url: string, title: string, links: QuickLink[], sites: { name: string; origin: string }[]): string {
  const host = hostOf(url);
  if (!host) return title.trim().slice(0, MAX_PAGE_NAME) || url;
  const site = baseDomain(host);
  const onSite = (u: string) => {
    const h = hostOf(u);
    return h !== null && baseDomain(h) === site;
  };
  // "English Subbed - Jav Guru", "Jav Guru | English Subbed", ...
  const parts = title
    .split(/\s+[|·•\-–—»›]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const addressKeys = [nameKey(host), nameKey(host.replace(/\.[^.]+$/, ''))];
  const isAddress = (p: string) => addressKeys.includes(nameKey(p));

  const saved = links.find((l) => onSite(l.url) && l.name.indexOf(SITE_DOT) > 0)?.name.split(SITE_DOT)[0].trim();
  const builtIn = sites.find((s) => onSite(s.origin))?.name;
  const fromTitle = parts.length > 1 ? parts.find(isAddress) : undefined;
  const siteName = saved || builtIn || fromTitle || host;

  const page = parts.filter((p) => !isAddress(p) && nameKey(p) !== nameKey(siteName)).join(' - ') || pathName(url);
  return page ? `${siteName}${SITE_DOT}${page.slice(0, MAX_PAGE_NAME).trim()}` : siteName;
}

/** The group a link is shown in: its group if that still exists, else null (no group). */
export function groupOf(state: LinkState, link: QuickLink): string | null {
  return link.group && hasGroup(state.linkGroups, link.group)
    ? state.linkGroups.find((g) => same(g, link.group!))!
    : null;
}

/**
 * Moves the link with this URL into `group` (null = no group), just before the link `before` (a URL in
 * that group), or after the group's last link when `before` is null.
 */
export function placeLink(state: LinkState, url: string, group: string | null, before: string | null): LinkState {
  const link = state.quickLinks.find((l) => l.url === url);
  if (!link || url === before) return state;
  const { group: _old, ...rest } = link;
  const moved: QuickLink = group ? { ...rest, group } : rest;
  const others = state.quickLinks.filter((l) => l.url !== url);
  let at = before ? others.findIndex((l) => l.url === before) : -1;
  if (at < 0) {
    let last = -1;
    others.forEach((l, i) => groupOf(state, l) === group && (last = i));
    at = last < 0 ? others.length : last + 1;
  }
  return { ...state, quickLinks: [...others.slice(0, at), moved, ...others.slice(at)] };
}

/** Adds a link at the end of its group. */
export function appendLink(state: LinkState, link: QuickLink): LinkState {
  const next = { ...state, quickLinks: [...state.quickLinks, link] };
  return placeLink(next, link.url, groupOf(next, link), null);
}

/** Moves a group just before `before`, or to the end when `before` is null. */
export function placeGroup(groups: string[], name: string, before: string | null): string[] {
  if (name === before || !groups.includes(name)) return groups;
  const others = groups.filter((g) => g !== name);
  const at = before ? others.indexOf(before) : -1;
  return at < 0 ? [...others, name] : [...others.slice(0, at), name, ...others.slice(at)];
}
