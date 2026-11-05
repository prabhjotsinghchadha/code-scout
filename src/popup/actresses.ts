// The popup's favourite actresses (Favourites tab → Actresses): one box to find or add a name, then each
// actress with a javtrailers search, ★ to remove her, and the page she was saved from underneath.
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
import { icon, type IconName } from '../shared/icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let actresses: Actress[] = [];
let openLinks: (urls: string[]) => unknown = () => {};
let onCount: (n: number) => void = () => {};

const input = () => $<HTMLInputElement>('actress-input');

function iconButton(name: IconName, label: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn ${className}`.trim();
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

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
  const li = Object.assign(document.createElement('li'), { className: 'fav' });
  const name = Object.assign(document.createElement('span'), { className: 'code', textContent: actress.name, title: actress.name });
  li.append(
    name,
    iconButton('search', `Search javtrailers.com for ${actress.name}`, '', () => void openLinks([rawSearchUrl(actress.name)])),
    iconButton('starFilled', 'Remove from favourite actresses', 'star on', () => void saving(() => removeActress(actress.name))),
  );
  if (actress.url) li.append(pageLink(actress.url));
  return li;
}

/** Lower case without spaces, so "yuamikami" finds "Yua Mikami". */
const squash = (s: string) => nameKey(s).replace(/\s/g, '');

function paint() {
  const typed = input().value;
  const query = squash(typed);
  const shown = query ? actresses.filter((a) => squash(a.name).includes(query)) : actresses;
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
