// Narrowing a list of videos to one label, performer or studio, and knowing which of those a list has most
// of. A code's label is its letters (always known); its performers and studio are known once the video has
// been looked up (details.ts). Pure, unit-tested; rows.ts has the button.
import { formatCode, type VideoCode } from '../shared/codes.ts';
import { englishName, type DetailsCache, type Named } from '../shared/details.ts';

export type FacetKind = 'label' | 'performer' | 'studio';
export interface Facet {
  kind: FacetKind;
  /** The label ("SONE"), or the performer's or studio's name. */
  value: string;
}
export interface FacetCount extends Facet {
  count: number;
  /** A performer's or studio's page on javtrailers. */
  url?: string;
}

const labelOf = (code: VideoCode) => code.prefix.toUpperCase();

/** Whether `code` is of this label, has this performer in it, or is from this studio. */
export function matchesFacet(code: VideoCode, facet: Facet, details: DetailsCache): boolean {
  if (facet.kind === 'label') return labelOf(code) === facet.value;
  const d = details[formatCode(code)];
  if (!d) return false;
  if (facet.kind === 'studio') return d.studio?.name === facet.value;
  return d.cast.some((c) => englishName(c.name) === facet.value);
}

/**
 * What these videos have in common, most frequent first (ties keep the list's order): labels, performers
 * and studios, at most `max` of each. `min`: only what at least this many of them share.
 */
export function facetsOf(codes: VideoCode[], details: DetailsCache, max = 6, min = 1): Record<FacetKind, FacetCount[]> {
  const counts: Record<FacetKind, Map<string, FacetCount>> = { label: new Map(), performer: new Map(), studio: new Map() };
  const count = (kind: FacetKind, value: string, item?: Named) => {
    const entry = counts[kind].get(value);
    if (entry) entry.count++;
    else counts[kind].set(value, { kind, value, count: 1, ...(item && { url: item.url }) });
  };
  for (const code of codes) {
    count('label', labelOf(code));
    const d = details[formatCode(code)];
    if (!d) continue;
    if (d.studio) count('studio', d.studio.name, d.studio);
    // Once per video, even if the site lists her twice.
    for (const [name, item] of new Map(d.cast.map((c) => [englishName(c.name), c]))) count('performer', name, item);
  }
  const top = (kind: FacetKind) =>
    [...counts[kind].values()]
      .filter((f) => f.count >= min)
      .sort((a, b) => b.count - a.count)
      .slice(0, max);
  return { label: top('label'), performer: top('performer'), studio: top('studio') };
}

/** "SONE", "with Rei Kamiki", "from Madonna": how a list says what it's narrowed to. */
export function facetText(facet: Facet): string {
  return facet.kind === 'label' ? facet.value : facet.kind === 'performer' ? `with ${facet.value}` : `from ${facet.value}`;
}
