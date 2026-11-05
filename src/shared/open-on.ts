// "Open on" sites: URL templates with a code placeholder, e.g. "https://missav.ws/en/{code_lower}".
import { formatCode, type VideoCode } from './codes.ts';

export interface OpenOnSite {
  id: string;
  name: string;
  /** URL with one or more placeholders from PLACEHOLDERS. */
  template: string;
}

/** Placeholders a template can use, with what they produce for NSFS-484. */
export const PLACEHOLDERS: { token: string; example: string; describe: string }[] = [
  { token: '{code}', example: 'NSFS-484', describe: 'uppercase with dash' },
  { token: '{code_lower}', example: 'nsfs-484', describe: 'lowercase with dash' },
  { token: '{id}', example: 'nsfs00484', describe: 'lowercase, number padded to 5 digits' },
];

const PLACEHOLDER_RE = /\{(code|code_lower|id)\}/g;

export function fillTemplate(template: string, code: VideoCode): string {
  const values: Record<string, string> = {
    code: formatCode(code),
    code_lower: formatCode(code).toLowerCase(),
    id: `${code.prefix}${String(code.number).padStart(5, '0')}`,
  };
  return template.replace(PLACEHOLDER_RE, (_, key: string) => encodeURIComponent(values[key]));
}

/** Returns an error message, or null if the template is usable. */
export function validateTemplate(template: string): string | null {
  const t = template.trim();
  if (!t) return 'Enter a URL.';
  if (!PLACEHOLDER_RE.test(t)) return 'Include {code}, {code_lower} or {id} where the code goes.';
  PLACEHOLDER_RE.lastIndex = 0;
  try {
    const url = new URL(fillTemplate(t, { prefix: 'nsfs', number: 484 }));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'The URL must start with http:// or https://';
  } catch {
    return 'That isn’t a valid URL (it should start with https://).';
  }
  return null;
}

/** "missav.ws" from a template, for a default site name. */
export function siteNameFromTemplate(template: string): string {
  try {
    return new URL(fillTemplate(template.trim(), { prefix: 'nsfs', number: 484 })).hostname.replace(/^www\./, '');
  } catch {
    return 'Site';
  }
}

export function newSiteId(): string {
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Only http(s) URLs may be opened from messages. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
