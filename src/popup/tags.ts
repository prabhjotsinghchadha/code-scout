// The popup's favourite tags (Favourites tab → Tags): one box to find or add a tag, then each tag with
// "Open all" (its pages on every site it was saved from), ★ to remove it, and a chip per site underneath
// (click to open that page; right-click to take it off the tag).
import { favouriteError } from '../shared/favourites';
import { siteKey } from '../shared/hosts';
import { icon, type IconName } from '../shared/icons';
import { openMenu } from '../shared/menu';
import { capitalized, cleanName } from '../shared/names';
import { addTag, getTags, onTagsChanged, removeTag, removeTagPage, tagLinks, tagNameKey, type Tag } from '../shared/tags';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Ask before opening more tabs than this at once (as in the Links tab). */
const CONFIRM_OVER = 8;

let tags: Tag[] = [];
let openLinks: (urls: string[]) => unknown = () => {};
let onCount: (n: number) => void = () => {};

const input = () => $<HTMLInputElement>('tag-input');

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
  const error = $('tag-error');
  try {
    await change();
    error.hidden = true;
  } catch (err) {
    error.textContent = favouriteError(err);
    error.hidden = false;
  }
}

function openAll(tag: Tag) {
  const urls = tagLinks(tag);
  if (urls.length <= CONFIRM_OVER || confirm(`Open ${urls.length} tabs?`)) void openLinks(urls);
}

/** A chip for one of a tag's pages: its site's name; right-click to take it off the tag. */
function pageChip(tag: Tag, page: string) {
  const a = Object.assign(document.createElement('a'), {
    className: 'chip',
    href: page,
    textContent: siteKey(page),
    title: `${page}\nRight-click to remove it from ${tag.name}`,
  });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void openLinks([page]);
  });
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(
      { x: e.clientX, y: e.clientY },
      [
        { label: 'Open', icon: 'external', onClick: () => void openLinks([page]) },
        { label: `Remove from ${tag.name}`, icon: 'trash', danger: true, onClick: () => void saving(() => removeTagPage(tag.name, page)) },
      ],
      a,
    );
  });
  return a;
}

function row(tag: Tag) {
  const li = Object.assign(document.createElement('li'), { className: 'fav tag' });
  const name = Object.assign(document.createElement('span'), { className: 'code', textContent: tag.name, title: tag.name });
  const many = tag.pages.length > 1;
  const openLabel = tag.pages.length
    ? many
      ? `Open ${tag.name} on all ${tag.pages.length} sites`
      : `Open ${tag.name}`
    : `Search javtrailers.com for ${tag.name}`;
  li.append(
    name,
    iconButton(tag.pages.length ? 'external' : 'search', openLabel, 'accent', () => openAll(tag)),
    iconButton('starFilled', 'Remove from favourite tags', 'star on', () => void saving(() => removeTag(tag.name))),
  );
  if (tag.pages.length) {
    const chips = Object.assign(document.createElement('div'), { className: 'tag-pages' });
    chips.append(...tag.pages.map((p) => pageChip(tag, p)));
    li.append(chips);
  }
  return li;
}

/** Lower case without spaces or dashes, so "cheatingwife" finds "Cheating Wife". */
const squash = (s: string) => tagNameKey(s).replace(/\s/g, '');

function paint() {
  const typed = input().value;
  const query = squash(typed);
  const shown = query ? tags.filter((t) => squash(t.name).includes(query)) : tags;
  $('tags').replaceChildren(...shown.map(row));
  $('tags-empty').hidden = tags.length > 0;
  $('tags-none').hidden = !tags.length || shown.length > 0;
  // "Add" once the box holds a name that isn't saved yet.
  const name = cleanName(typed);
  const add = $<HTMLButtonElement>('tag-add');
  add.disabled = !name || tags.some((t) => tagNameKey(t.name) === tagNameKey(name));
  $('tags-none').textContent = add.disabled ? 'No saved tag matches.' : 'No saved tag matches. Press Enter to add it.';
}

async function render() {
  tags = await getTags();
  onCount(tags.length);
  paint();
}

/**
 * Sets up the Tags view. `open` opens URLs next to the current tab; `count` is told how many tags are
 * saved, now and after every change. Resolves once they're shown.
 */
export async function setupTags(open: (urls: string[]) => unknown, count: (n: number) => void) {
  openLinks = open;
  onCount = count;
  input().addEventListener('input', () => {
    $('tag-error').hidden = true;
    paint();
  });
  $<HTMLFormElement>('tag-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanName(input().value);
    if (!name) {
      $('tag-error').textContent = 'Type a tag, like NTR or Cheating Wife.';
      $('tag-error').hidden = false;
      return;
    }
    if (tags.some((t) => tagNameKey(t.name) === tagNameKey(name))) return; // already saved: the filter shows it
    void saving(async () => {
      await addTag(capitalized(name));
      input().value = '';
      await render();
    });
  });
  onTagsChanged(() => void render());
  await render();
}
