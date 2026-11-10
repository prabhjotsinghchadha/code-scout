// The popup's favourite actresses (Favourites tab → Actresses): one box to add a name (it filters the list
// as you type), then each actress: click her to open the page she was saved from (or a javtrailers search
// for her name), with Search and ★ to remove her after it.
import {
  addActress,
  capitalized,
  cleanName,
  getActresses,
  nameKey,
  onActressesChanged,
  removeActress,
  type Actress,
} from '../shared/actresses';
import { rawSearchUrl } from '../shared/codes';
import { favouriteError } from '../shared/favourites';
import { icon } from '../shared/icons';
import { iconButton, rowActions, rowMain, sortButton } from './rows';
import { NAME_SORTS, sortByName, storedSort, storeSort, type NameSort } from './sort';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let actresses: Actress[] = [];
let sort: NameSort = 'newest';
let openLinks: (urls: string[]) => unknown = () => {};
let onCount: (n: number) => void = () => {};

const input = () => $<HTMLInputElement>('actress-input');

/** Makes a change, showing why if it couldn't be saved. */
async function saving(change: () => Promise<unknown>) {
  const error = $('actress-error');
  try {
    await change();
    error.hidden = true;
  } catch (err) {
    error.textContent = favouriteError(err);
    error.hidden = false;
  }
}

/** Her saved page as a full-width link under the row, opened next to this tab. */
function pageLink(url: string) {
  const a = Object.assign(document.createElement('a'), {
    className: 'fav-page',
    href: url,
    textContent: url.replace(/^https?:\/\/(www\.)?/, ''),
    title: url,
  });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void openLinks([url]);
  });
  return a;
}

function row(actress: Actress) {
  const li = document.createElement('li');
  const name = Object.assign(document.createElement('span'), { className: 'code', textContent: actress.name });
  const search = () => void openLinks([rawSearchUrl(actress.name)]);
  const { url } = actress;
  const main = url
    ? rowMain([icon('heart', 11)], name, `Open ${actress.name}’s page`, () => void openLinks([url]), 'heart')
    : rowMain([icon('heart', 11)], name, `Search javtrailers.com for ${actress.name}`, search, 'heart');
  const remove = iconButton('starFilled', 'Remove from favourite actresses', 'star on', () => void saving(() => removeActress(actress.name)));
  const actions = url
    ? rowActions(iconButton('search', `Search javtrailers.com for ${actress.name}`, 'quiet', search), remove)
    : rowActions(remove);
  li.append(main, actions);
  if (url) li.append(pageLink(url));
  return li;
}

/** Rows for the saved actresses whose name has `text` in it (for the popup's search box). */
export function actressRows(text: string): HTMLLIElement[] {
  const query = squash(text);
  return query ? actresses.filter((a) => squash(a.name).includes(query)).map(row) : [];
}

/** Lower case without spaces, so "yuamikami" finds "Yua Mikami". */
const squash = (s: string) => nameKey(s).replace(/\s/g, '');

function paint() {
  const typed = input().value;
  const query = squash(typed);
  const sorted = sortByName(actresses, sort);
  const shown = query ? sorted.filter((a) => squash(a.name).includes(query)) : sorted;
  $('actresses').replaceChildren(...shown.map(row));
  $('actresses-empty').hidden = actresses.length > 0;
  $('actresses-none').hidden = !actresses.length || shown.length > 0;
  // "Add" once the box holds a name that isn't saved yet.
  const name = cleanName(typed);
  const add = $<HTMLButtonElement>('actress-add');
  add.disabled = !name || actresses.some((a) => nameKey(a.name) === nameKey(name));
  $('actresses-none').textContent = add.disabled ? 'No saved actress matches.' : 'No saved actress matches. Press Enter to add her.';
}

async function render(list?: Actress[]) {
  actresses = list ?? (await getActresses());
  onCount(actresses.length);
  paint();
}

/**
 * Sets up the Actresses view. `open` opens URLs next to the current tab; `count` is told how many
 * actresses are saved, now and after every change. Resolves once they're shown.
 */
export async function setupActresses(open: (urls: string[]) => unknown, count: (n: number) => void) {
  openLinks = open;
  onCount = count;
  sort = storedSort('favs-actresses', NAME_SORTS);
  sortButton($<HTMLButtonElement>('favs-sort-actresses'), NAME_SORTS, () => sort, (value) => {
    sort = value;
    storeSort('favs-actresses', value);
    paint();
  });
  input().addEventListener('input', () => {
    $('actress-error').hidden = true;
    paint();
  });
  $<HTMLFormElement>('actress-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanName(input().value);
    if (!name) {
      $('actress-error').textContent = 'Type a name, like Yua Mikami.';
      $('actress-error').hidden = false;
      return;
    }
    if (actresses.some((a) => nameKey(a.name) === nameKey(name))) return; // already saved: the filter shows her
    void saving(async () => {
      await addActress(capitalized(name));
      input().value = '';
      await render();
    });
  });
  onActressesChanged(() => void render());
  await render();
}
