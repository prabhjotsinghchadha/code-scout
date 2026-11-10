// What the popup's lists are made of: a row opens with one click on its name (a round glyph, then the
// name), and its other actions are small icon buttons after it.
import { icon, type IconName } from '../shared/icons';
import type { VideoCode } from '../shared/codes';
import type { DetailsCache } from '../shared/details';
import { openMenu, type MenuItem } from '../shared/menu';
import { facetsOf, facetText, type Facet, type FacetCount } from './filter';

/** A square icon button; `label` is its tooltip and accessible name. */
export function iconButton(name: IconName, label: string, className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn ${className}`.trim();
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The part of a row that opens it: `glyph` in a circle, then `label`. `kind` colours the circle ("heart",
 * "hash", "plain"; rose by default). The arrow keys move between these (see main.ts).
 */
export function rowMain(glyph: (Node | string)[], label: HTMLElement, title: string, onClick: () => void, kind = '') {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'row-main', title });
  const go = Object.assign(document.createElement('span'), { className: `row-go ${kind}`.trim() });
  go.setAttribute('aria-hidden', 'true');
  go.append(...glyph);
  b.append(go, label);
  b.addEventListener('click', onClick);
  return b;
}

/** The icon buttons after a row's name. */
export function rowActions(...buttons: HTMLElement[]) {
  const box = Object.assign(document.createElement('span'), { className: 'row-actions' });
  box.append(...buttons);
  return box;
}

/**
 * A small button that says how a list is sorted and opens the choices. `picked` gives the choice now;
 * `onPick` is told a new one (and should redraw the list).
 */
export function sortButton<T extends string>(
  b: HTMLButtonElement,
  choices: readonly { value: T; label: string }[],
  picked: () => T,
  onPick: (value: T) => void,
) {
  const paint = () => {
    const label = choices.find((c) => c.value === picked())?.label ?? '';
    b.title = `Sorted: ${label}. Click to change`;
    b.setAttribute('aria-label', `Sort. Now: ${label}`);
    // Lit while it isn't the usual order, so a list that looks out of order explains itself.
    b.classList.toggle('on', picked() !== choices[0].value);
  };
  b.replaceChildren(icon('sort', 15));
  b.setAttribute('aria-haspopup', 'menu');
  b.addEventListener('click', () => {
    openMenu(
      b.getBoundingClientRect(),
      [
        { heading: 'Sort by' },
        ...choices.map((c) => ({
          label: c.label,
          checked: c.value === picked(),
          onClick: () => {
            onPick(c.value);
            paint();
          },
        })),
      ],
      b,
    );
  });
  paint();
  return paint;
}

/**
 * A small button that narrows a list of videos to one label, performer or studio, picked from what the list
 * has most of, and the chip that says what it's narrowed to (click it to show everything again). `codes`:
 * the whole list; `details`: what's known about them; `picked` / `onPick`: the choice (null = everything).
 */
export function filterButton(
  b: HTMLButtonElement,
  chip: HTMLButtonElement,
  codes: () => VideoCode[],
  details: () => DetailsCache,
  picked: () => Facet | null,
  onPick: (facet: Facet | null) => void,
) {
  const paint = () => {
    const facet = picked();
    b.classList.toggle('on', !!facet);
    b.title = facet ? `Showing only ${facetText(facet)}. Click to change` : 'Show only one label, performer or studio';
    b.setAttribute('aria-label', b.title);
    chip.hidden = !facet;
    if (facet) {
      chip.replaceChildren(facetText(facet), icon('x', 11));
      chip.title = 'Show everything again';
    }
  };
  const pick = (facet: Facet | null) => {
    onPick(facet);
    paint();
  };
  b.replaceChildren(icon('filter', 15));
  b.setAttribute('aria-haspopup', 'menu');
  chip.addEventListener('click', () => pick(null));
  b.addEventListener('click', () => {
    const now = picked();
    const found = facetsOf(codes(), details());
    const group = (heading: string, list: FacetCount[]): MenuItem[] =>
      list.length
        ? [
            { heading },
            ...list.map((f) => ({
              label: `${f.value}  ·  ${f.count}`,
              checked: !!now && now.kind === f.kind && now.value === f.value,
              onClick: () => pick({ kind: f.kind, value: f.value }),
            })),
          ]
        : [];
    const items: MenuItem[] = [
      ...(now ? [{ label: 'Show everything', icon: 'x' as const, onClick: () => pick(null) }, 'separator' as const] : []),
      ...group('Label', found.label),
      ...group('Performer', found.performer),
      ...group('Studio', found.studio),
    ];
    // Performers and studios are known for videos that have been looked up: say so here, where it's asked.
    if (!found.performer.length && !found.studio.length) {
      items.push('separator', { label: 'Open a video’s card to filter by performer or studio', onClick: () => {}, disabled: true });
    }
    openMenu(b.getBoundingClientRect(), items, b);
  });
  paint();
  return paint;
}
