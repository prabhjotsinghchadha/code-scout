// What a code is, in the popup: a line under a code's row once its details are known (title, performers,
// studio), and the card a row opens into: cover, title, date and length, then the people and things it's
// connected to, each one click from being opened or saved. Details are asked for when a card is opened
// (or a code starred); nothing is fetched for rows that are only listed.
import { addActress, getActresses, nameKey, removeActress } from '../shared/actresses';
import { formatCode, rawSearchUrl, type VideoCode } from '../shared/codes';
import { detailsLine, englishName, getDetailsCache, onDetailsChanged, type DetailsCache, type Named, type VideoDetails } from '../shared/details';
import { favouriteError, type FavouritePage } from '../shared/favourites';
import { icon } from '../shared/icons';
import { sendToBackground } from '../shared/messages';
import { addTag, getTags, removeTag, tagNameKey } from '../shared/tags';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}) =>
  Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];

let cache: DetailsCache = {};

export const detailsOf = (code: VideoCode): VideoDetails | undefined => cache[formatCode(code)];
export const allDetails = (): DetailsCache => cache;

/** Reads what's kept, and keeps the rows' lines current as more is learned. */
export async function setupDetails() {
  cache = await getDetailsCache().catch(() => ({}));
  onDetailsChanged((next) => {
    cache = next;
    document.querySelectorAll<HTMLElement>('.row-sub[data-sub]').forEach(paintSub);
  });
}

function paintSub(sub: HTMLElement) {
  const d = cache[sub.dataset.sub ?? ''];
  sub.hidden = !d;
  if (!d) return;
  const who = detailsLine(d);
  sub.replaceChildren(el('span', { className: 'sub-title', textContent: d.title }));
  if (who) sub.append(el('span', { className: 'sub-who', textContent: who }));
  sub.title = [d.title, who].filter(Boolean).join('\n');
}

/** The line under a code: its title, then who's in it and the studio. Empty until its details are known. */
export function subLine(code: VideoCode): HTMLElement {
  const sub = el('div', { className: 'row-sub' });
  sub.dataset.sub = formatCode(code);
  paintSub(sub);
  return sub;
}

/** Asks for a code's details to be read and kept (it was starred): its row then says what it is. */
export function learn(code: VideoCode) {
  if (!detailsOf(code)) void sendToBackground({ type: 'GET_DETAILS', code }).catch(() => {});
}

export interface CardTools {
  /** Opens addresses next to the tab (and closes the popup). */
  openLinks: (urls: string[], code?: VideoCode) => unknown;
  /** The "Watch on" site buttons for a code, or null when there are no sites. */
  siteRow: (code: VideoCode) => HTMLElement | null;
}

function group(label: string, ...children: HTMLElement[]) {
  const box = el('div', { className: 'detail-group' });
  box.append(el('span', { className: 'detail-label', textContent: label }), ...children);
  return box;
}

/** A chip that opens something's page (a studio, a series). */
function openChip(item: Named, tools: CardTools) {
  const b = el('button', { type: 'button', className: 'chip', textContent: item.name, title: `Open ${item.name} on javtrailers` });
  b.addEventListener('click', () => void tools.openLinks([item.url]));
  return b;
}

/**
 * A chip in two parts: a sign that saves or un-saves (♥ a performer, # a genre) and the name, which opens
 * its page. `saved` says whether it's saved now; `toggle` changes that.
 */
function saveChip(item: Named, name: string, sign: Node, kind: 'heart' | 'hash', saved: boolean, toggle: (save: boolean) => Promise<unknown>, tools: CardTools, card: HTMLElement) {
  const chip = el('span', { className: `chip duo ${kind}` });
  const save = el('button', { type: 'button', className: 'duo-save' });
  save.append(sign);
  const what = kind === 'heart' ? 'favourite performers' : 'favourite genres';
  const paint = (on: boolean) => {
    saved = on;
    chip.classList.toggle('on', on);
    save.title = on ? `Remove ${name} from your ${what}` : `Add ${name} to your ${what}`;
    save.setAttribute('aria-label', save.title);
    save.setAttribute('aria-pressed', String(on));
  };
  paint(saved);
  save.addEventListener('click', async () => {
    const error = card.querySelector<HTMLElement>('.detail-error')!;
    try {
      await toggle(!saved);
      paint(!saved);
      error.hidden = true;
    } catch (err) {
      error.textContent = favouriteError(err);
      error.hidden = false;
    }
  });
  const open = el('button', { type: 'button', className: 'duo-name', textContent: name, title: `${item.name}\nOpen on javtrailers` });
  open.addEventListener('click', () => void tools.openLinks([item.url]));
  chip.append(save, open);
  return chip;
}

async function fill(card: HTMLElement, d: VideoDetails, tools: CardTools) {
  const [actresses, tags] = await Promise.all([getActresses().catch(() => []), getTags().catch(() => [])]);
  const savedPerformers = new Set(actresses.map((a) => nameKey(a.name)));
  const savedGenres = new Set(tags.map((t) => tagNameKey(t.name)));
  const out: HTMLElement[] = [];

  const top = el('div', { className: 'detail-top' });
  if (d.cover) {
    const img = el('img', { className: 'detail-cover', src: d.cover, alt: '', loading: 'lazy' });
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());
    top.append(img);
  }
  const text = el('div', { className: 'detail-text' });
  const facts = [d.released, d.minutes ? `${d.minutes} min` : ''].filter(Boolean).join(' · ');
  text.append(el('p', { className: 'detail-title', textContent: d.title }));
  if (facts) text.append(el('p', { className: 'detail-facts', textContent: facts }));
  top.append(text);
  out.push(top);

  if (d.cast.length) {
    out.push(
      group(
        d.cast.length > 1 ? 'Performers' : 'Performer',
        ...d.cast.map((c) => {
          const name = englishName(c.name);
          const toggle = (save: boolean) => (save ? addActress(name, c.url) : removeActress(name));
          return saveChip(c, name, icon('heart', 11), 'heart', savedPerformers.has(nameKey(name)), toggle, tools, card);
        }),
      ),
    );
  }
  const made = [d.studio && group('Studio', openChip(d.studio, tools)), d.series && group('Series', openChip(d.series, tools))].filter((g) => !!g);
  out.push(...made);
  if (d.genres.length) {
    out.push(
      group(
        'Genres',
        ...d.genres.map((g) => {
          const toggle = (save: boolean) => (save ? addTag(g.name, g.url) : removeTag(g.name));
          return saveChip(g, g.name, document.createTextNode('#'), 'hash', savedGenres.has(tagNameKey(g.name)), toggle, tools, card);
        }),
      ),
    );
  }
  card.querySelector('.detail-body')!.replaceChildren(...out);
}

/**
 * The card under a code's row. The ways on (more from its label, where to watch it, the page it was
 * starred or seen on) show at once; what the video is fills in when javtrailers answers, or says why not.
 */
export function detailCard(code: VideoCode, tools: CardTools, source?: FavouritePage | null): HTMLLIElement {
  const li = el('li', { className: 'detail' });
  const card = el('div', { className: 'detail-card' });
  const body = el('div', { className: 'detail-body' });
  const known = detailsOf(code);
  body.append(el('p', { className: 'detail-note', textContent: known ? '' : 'Looking it up on javtrailers…' }));

  const more = el('div', { className: 'detail-more' });
  const label = code.prefix.toUpperCase();
  const series = el('button', { type: 'button', className: 'chip', textContent: `More ${label} releases` });
  series.title = `Other videos whose code starts with ${label} (the same label), on javtrailers`;
  series.addEventListener('click', () => void tools.openLinks([rawSearchUrl(label)]));
  more.append(series);
  if (source?.url) {
    const from = el('button', { type: 'button', className: 'chip', textContent: 'The page it was on' });
    from.title = `${source.title ?? ''}\n${source.url}`.trim();
    from.addEventListener('click', () => void tools.openLinks([source.url]));
    more.append(from);
  }
  const error = el('p', { className: 'error detail-error', hidden: true });
  card.append(body, more);
  const sites = tools.siteRow(code);
  if (sites) card.append(sites);
  card.append(error);
  li.append(card);

  if (known) void fill(card, known, tools);
  void sendToBackground({ type: 'GET_DETAILS', code })
    .then((result) => {
      if (!li.isConnected) return;
      if ('details' in result) return fill(card, result.details, tools);
      if (!known) body.replaceChildren(el('p', { className: 'detail-note', textContent: result.error }));
    })
    .catch(() => {
      if (!known) body.replaceChildren(el('p', { className: 'detail-note', textContent: 'Reload Code Scout to look videos up.' }));
    });
  return li;
}

/** Performers, studios, series and genres among the videos looked at whose name has one of `needles` in it. */
export function findKnown(matches: (text: string) => boolean, max = 8): { performers: Named[]; studios: Named[]; genres: Named[] } {
  const seen = { performers: new Map<string, Named>(), studios: new Map<string, Named>(), genres: new Map<string, Named>() };
  const add = (into: Map<string, Named>, item: Named | undefined) => {
    if (item && into.size < max && !into.has(item.url) && matches(item.name)) into.set(item.url, item);
  };
  for (const d of Object.values(cache)) {
    d.cast.forEach((c) => add(seen.performers, c));
    add(seen.studios, d.studio);
    add(seen.studios, d.series);
    d.genres.forEach((g) => add(seen.genres, g));
  }
  return { performers: [...seen.performers.values()], studios: [...seen.studios.values()], genres: [...seen.genres.values()] };
}
