// Built-in sites, each defined once: its "Open on" URL pattern and the pages offered as quick links.
//
// To add a site, append an entry; to add a page, append it to the site's `pages`. That's all: every
// install is offered new items once, on its next update (see seed.ts), and nothing needs a version bump.
//
// Ids are how installs remember what they were offered, so never change or reuse one. Editing a URL,
// name or group of an existing item only affects installs that haven't been offered it yet; installs
// that have it keep their copy (the user may have edited it).
// Order matters for new installs: sites and their pages are added in this order.

export interface SitePage {
  /** Unique within the site, e.g. "english-subtitle". */
  id: string;
  /** Shown after the site name: "MissAV · English subtitle". Omit to show just the site name. */
  label?: string;
  /** Path and query on the site's origin, starting with "/". */
  path: string;
  /** Quick-link group, one of GROUPS. Omit to leave the link ungrouped. */
  group?: string;
}

export interface Site {
  /** Unique, e.g. "missav". Also the id of the site's "Open on" entry. */
  id: string;
  name: string;
  /** Scheme and host only, e.g. "https://missav.ws" (keep "www." if the site uses it). */
  origin: string;
  /** "Open on" pattern: a path with a code placeholder from open-on.ts, e.g. "/en/{code_lower}". */
  openOn?: string;
  /** Pages offered as quick links. */
  pages?: SitePage[];
}

/** Built-in quick-link groups, in display order. A group may have no built-in links (NTR). */
export const GROUPS = ['Cheating', 'Cuckold', 'NTR', 'All Japanese', 'Subtitles', 'More sites'];

export const SITES: Site[] = [
  {
    id: 'missav',
    name: 'MissAV',
    origin: 'https://missav.ws',
    openOn: '/en/{code_lower}',
    pages: [{ id: 'english-subtitle', label: 'English subtitle', path: '/dm23/en/english-subtitle', group: 'Subtitles' }],
  },
  {
    id: 'javlibrary',
    name: 'JavLibrary',
    origin: 'https://www.javlibrary.com',
    openOn: '/en/vl_searchbyid.php?keyword={code}',
    pages: [{ id: 'most-wanted', label: 'Most wanted', path: '/en/vl_mostwanted.php' }],
  },
  {
    id: 'javmost',
    name: 'JavMost',
    origin: 'https://www.javmost.ws',
    openOn: '/{code}/',
    pages: [{ id: 'cuckold', label: 'Cuckold', path: '/category/Cuckold/', group: 'Cuckold' }],
  },
  {
    id: 'javtiful',
    name: 'Javtiful',
    origin: 'https://javtiful.com',
    openOn: '/search?q={code_lower}',
    pages: [{ id: 'affair', label: 'Affair (popular)', path: '/category/affair?sort=popular', group: 'Cheating' }],
  },
  {
    // The main trailer site; opening codes on it is built in (codes.ts), so no "Open on" entry.
    id: 'javtrailers',
    name: 'JavTrailers',
    origin: 'https://javtrailers.com',
    pages: [
      { id: 'cheating-wife', label: 'Cheating Wife', path: '/categories/cheating-wife', group: 'Cheating' },
      { id: 'adultery', label: 'Adultery', path: '/categories/adultery', group: 'Cheating' },
    ],
  },
  {
    id: 'beeg',
    name: 'Beeg',
    origin: 'https://beeg.com',
    pages: [{ id: 'cuckold-japanese', label: 'Cuckold Japanese', path: '/Cuckold+Japanese', group: 'Cuckold' }],
  },
  {
    id: 'faphouse',
    name: 'FapHouse',
    origin: 'https://faphouse2.com',
    pages: [{ id: 'japanese', label: 'Japanese', path: '/c/japanese/videos', group: 'All Japanese' }],
  },
  {
    id: 'pornhub',
    name: 'Pornhub',
    origin: 'https://www.pornhub.com',
    pages: [{ id: 'japanese', label: 'Japanese', path: '/categories/japanese', group: 'All Japanese' }],
  },
  {
    id: 'youporn',
    name: 'YouPorn',
    origin: 'https://www.youporn.com',
    pages: [{ id: 'japanese', label: 'Japanese', path: '/category/japanese/', group: 'All Japanese' }],
  },
  {
    id: 'javguru',
    name: 'Jav Guru',
    origin: 'https://jav.guru',
    openOn: '/?s={code}',
    pages: [{ id: 'english-subbed', label: 'English subbed', path: '/category/english-subbed/', group: 'Subtitles' }],
  },
  {
    id: '18jav',
    name: '18JAV',
    origin: 'https://18jav.tv',
    pages: [{ id: 'chinese-subtitle', label: 'Chinese subtitle', path: '/categories/chinese-subtitle', group: 'Subtitles' }],
  },
  {
    id: 'jable',
    name: 'Jable',
    origin: 'https://jable.tv',
    openOn: '/videos/{code_lower}/',
    pages: [{ id: 'home', label: 'Home (English)', path: '/?lang=en', group: 'More sites' }],
  },
  {
    id: 'supjav',
    name: 'SupJav',
    origin: 'https://supjav.com',
    openOn: '/?s={code_lower}',
    pages: [{ id: 'english-subtitles', label: 'English subtitles', path: '/category/english-subtitles', group: 'Subtitles' }],
  },
  {
    id: 'bestjavporn',
    name: 'BestJavPorn',
    origin: 'https://www.bestjavporn.com',
    openOn: '/search/{code_lower}/',
    pages: [
      { id: 'english-subtitle', label: 'English subtitle', path: '/v10/category/censored/english-subtitle/', group: 'Subtitles' },
    ],
  },
  {
    id: 'sextb',
    name: 'SexTB',
    origin: 'https://sextb.net',
    openOn: '/search/{code_lower}',
    pages: [{ id: 'home', path: '/', group: 'More sites' }],
  },
  { id: '7mmtv', name: '7MMTV', origin: 'https://7mmtv.sx', pages: [{ id: 'home', path: '/', group: 'More sites' }] },
  {
    id: 'koreanpornmovie',
    name: 'Korean Porn Movie',
    origin: 'https://koreanpornmovie.com',
    pages: [{ id: 'home', path: '/', group: 'More sites' }],
  },
  {
    id: 'theporndude',
    name: 'ThePornDude',
    origin: 'https://theporndude.com',
    pages: [{ id: 'home', label: 'All sites', path: '/', group: 'More sites' }],
  },
];

/**
 * What each built-in site is for, in a line: shown where sites are listed (the popup's "Watch on", the
 * Guide), so their names needn't be known. Sites the user adds have none.
 */
const ABOUT: Record<string, string> = {
  javtrailers: 'Trailers and details for every release: title, performers, studio, genres. Where Code Scout opens a code',
  missav: 'Full videos to stream; has an English-subtitle section',
  javlibrary: 'A database, no videos: every release with its performers, ratings and comments',
  javmost: 'Full videos to stream',
  javtiful: 'Full videos to stream',
  javguru: 'Full videos to stream; has an English-subbed section',
  jable: 'Full videos to stream',
  supjav: 'Full videos to stream; has an English-subtitle section',
  bestjavporn: 'Full videos to stream; has an English-subtitle section',
  sextb: 'Full videos to stream',
};

/** What the built-in site with this id is for, if it's one of them. */
export function aboutSite(id: string): string | undefined {
  return Object.hasOwn(ABOUT, id) ? ABOUT[id] : undefined;
}
