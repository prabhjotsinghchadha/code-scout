// The box's last section: what a site's own search finds for the text, listed here to pick from. Nothing
// is read while typing: the first row asks ("Search javtrailers for …"), then the results take its place,
// each one click from its page. The site searched (javtrailers or Jav Guru) is picked in the heading.
import { formatCode, type VideoCode } from '../shared/codes';
import type { FavouritePage } from '../shared/favourites';
import { icon } from '../shared/icons';
import { sendToBackground } from '../shared/messages';
import { isSearchSource, SEARCH_SOURCES, sourceName, webSearchUrl, type SearchSource, type WebResult } from '../shared/web-search';
import { rowActions, rowMain } from './rows';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}) =>
  Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];

export interface WebTools {
  /** Opens addresses next to the tab (and closes the popup). */
  openLinks: (urls: string[], code?: VideoCode) => unknown;
  /** The code's name, with a ✓ once it has been seen. */
  codeLabel: (code: VideoCode) => HTMLElement;
  /** The buttons after a result that has a code (☆, and the arrow that opens its card under `li`). */
  actions: (li: HTMLLIElement, code: VideoCode, page: FavouritePage) => HTMLElement[];
}

// The site picked last is a per-browser convenience, so localStorage is enough.
const SOURCE_KEY = 'webSource';
function storedSource(): SearchSource {
  try {
    const stored = localStorage.getItem(SOURCE_KEY);
    return isSearchSource(stored) ? stored : 'javtrailers';
  } catch {
    return 'javtrailers';
  }
}

let source = storedSource();
/** The text searched for, and what came of it. `asked`: a search was asked for, so a new site is searched at once. */
let query = '';
let asked = false;
let answer: { for: string; results: WebResult[] } | { for: string; error: string } | null = null;
/** The section on show (redrawn in place when an answer comes in). */
let body: HTMLElement | null = null;
let pills: HTMLElement | null = null;
let tools: WebTools;

const key = () => `${source}\n${query}`;

function note(text: string) {
  return el('p', { className: 'detail-note web-note-line', textContent: text });
}

function plainRow(glyph: Node, text: string, title: string, onClick: () => void) {
  const li = el('li');
  li.append(rowMain([glyph], el('span', { className: 'code', textContent: text }), title, onClick, 'plain'));
  return li;
}

function resultRow(r: WebResult): HTMLLIElement {
  const li = el('li', { className: 'web-row' });
  const text = el('span', { className: 'web-text' });
  if (r.code) {
    const top = el('span', { className: 'web-top' });
    top.append(tools.codeLabel(r.code));
    if (r.note) top.append(el('span', { className: 'web-note', textContent: r.note }));
    text.append(top);
  }
  text.append(el('span', { className: r.code ? 'web-title' : 'web-title only', textContent: r.title }));
  const name = r.code ? `${formatCode(r.code)} ${r.title}` : r.title;
  const main = el('button', { type: 'button', className: 'row-main', title: `${name}\nOpen it on ${sourceName(source)}` });
  if (r.cover) {
    const img = el('img', { className: `web-cover ${source}`, src: r.cover, alt: '', loading: 'lazy' });
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());
    main.append(img);
  }
  main.append(text);
  main.addEventListener('click', () => void tools.openLinks([r.url], r.code));
  li.append(main);
  if (r.code) li.append(rowActions(...tools.actions(li, r.code, { url: r.url, title: name.slice(0, 200) })));
  return li;
}

async function run() {
  asked = true;
  const asking = key();
  const text = query;
  paint();
  const result = await sendToBackground({ type: 'WEB_SEARCH', source, text }).catch(() => ({ error: 'Reload Code Scout to search from here.' }));
  if (asking !== key()) return; // the text or the site changed meanwhile
  answer = { for: asking, ...result };
  paint();
}

function paint() {
  if (!body || !pills) return;
  const site = sourceName(source);
  for (const b of pills.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.source === source));
  const list = el('ul', { className: 'list' });
  const openPage = () =>
    plainRow(icon('external', 12), `Open ${site}’s search page`, `Opens ${webSearchUrl(source, query)} in a new tab`, () => void tools.openLinks([webSearchUrl(source, query)]));
  const mine = answer?.for === key() ? answer : null;
  if (!mine) {
    if (asked) {
      body.replaceChildren(note(`Searching ${site}…`));
    } else {
      list.append(plainRow(icon('search', 12), `Search ${site} for “${query}”`, `Lists what ${site} finds, here`, () => void run()));
      body.replaceChildren(list);
    }
    return;
  }
  if ('error' in mine) {
    list.append(openPage());
    body.replaceChildren(note(mine.error), list);
    return;
  }
  list.append(...mine.results.map(resultRow), openPage());
  body.replaceChildren(...(mine.results.length ? [] : [note(`${site} has nothing for “${query}”.`)]), list);
}

/** The section for `text`: the row that asks, or what was found if this text was already searched for. */
export function webSection(text: string, withTools: WebTools): HTMLElement {
  tools = withTools;
  if (text !== query) {
    query = text;
    asked = false;
    answer = null;
  }
  const box = el('section', { className: 'find-section web' });
  const head = el('div', { className: 'section-head' });
  pills = el('span', { className: 'web-sources' });
  pills.setAttribute('role', 'toolbar');
  pills.setAttribute('aria-label', 'Site to search');
  for (const s of SEARCH_SOURCES) {
    const b = el('button', { type: 'button', className: 'gpill', textContent: s.name, title: `Search ${s.name}: ${s.about.toLowerCase()}` });
    b.dataset.source = s.id;
    b.addEventListener('click', () => {
      if (source === s.id) return;
      source = s.id;
      try {
        localStorage.setItem(SOURCE_KEY, s.id);
      } catch {
        // Not remembered, that's all.
      }
      // Already searching: the other site is asked the same thing.
      if (asked && answer?.for !== key()) void run();
      else paint();
    });
    pills.append(b);
  }
  head.append(el('span', { className: 'section-title', textContent: 'On the web' }), pills);
  body = el('div', { className: 'web-body' });
  box.append(head, body);
  paint();
  return box;
}
