// The look the user picks in Settings → Appearance: light, dark or the system's, and an accent colour.
// The extension's own pages take it from data-theme / data-accent on <html> (the colours are in ui.css);
// what Code Scout draws on websites takes the accent from CSS variables set on the page (content.css).

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The accents. `swatch` is what Settings shows. On pages: `mark` fills the ▶ buttons (any background),
 * `ui` the lit buttons of the chip, menu and video toolbar (always dark), `on` is the text on `ui`, and
 * `soft` is accent-coloured text on those dark surfaces. Orange, green and purple rather than amber, teal
 * and violet, so the accent is never the colour of a favourite's ★, a tag's # or an actress's ♥.
 */
export const ACCENTS = {
  rose: { label: 'Rose', swatch: '#e11d48', mark: '#e11d48', markHover: '#be123c', ui: '#e11d48', uiHover: '#be123c', on: '#ffffff', soft: '#fda4af' },
  orange: { label: 'Orange', swatch: '#ea580c', mark: '#ea580c', markHover: '#c2410c', ui: '#ea580c', uiHover: '#c2410c', on: '#ffffff', soft: '#fdba74' },
  green: { label: 'Green', swatch: '#16a34a', mark: '#16a34a', markHover: '#15803d', ui: '#16a34a', uiHover: '#15803d', on: '#ffffff', soft: '#86efac' },
  blue: { label: 'Blue', swatch: '#2563eb', mark: '#2563eb', markHover: '#1d4ed8', ui: '#2563eb', uiHover: '#1d4ed8', on: '#ffffff', soft: '#93c5fd' },
  purple: { label: 'Purple', swatch: '#9333ea', mark: '#9333ea', markHover: '#7e22ce', ui: '#9333ea', uiHover: '#7e22ce', on: '#ffffff', soft: '#d8b4fe' },
  // Near-black on pages (a seen code's ✓ is mid-grey), near-white on the dark chip and toolbar.
  graphite: { label: 'Graphite', swatch: '#3f3f46', mark: '#27272a', markHover: '#09090b', ui: '#e4e4e7', uiHover: '#ffffff', on: '#18181b', soft: '#e4e4e7' },
} as const;
export type Accent = keyof typeof ACCENTS;

export const DEFAULT_THEME: Theme = 'system';
export const DEFAULT_ACCENT: Accent = 'rose';

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);
export const isAccent = (value: unknown): value is Accent => typeof value === 'string' && Object.hasOwn(ACCENTS, value);

/** The variables content.css reads for the accent (it falls back to rose without them). */
export function onPageAccentVars(accent: unknown): Record<string, string> {
  const a = ACCENTS[isAccent(accent) ? accent : DEFAULT_ACCENT];
  return {
    '--javtr-accent': a.mark,
    '--javtr-accent-hover': a.markHover,
    '--javtr-ui': a.ui,
    '--javtr-ui-hover': a.uiHover,
    '--javtr-on-ui': a.on,
    '--javtr-soft': a.soft,
  };
}

/** Where the extension's pages keep the last look, so the next one opens in it (see public/theme-boot.js). */
export const THEME_MIRROR_KEY = 'look';

/** Puts the look on an extension page, and remembers it for the next page opened. */
export function applyTheme(look: { theme: unknown; accent: unknown }, root: HTMLElement = document.documentElement) {
  const theme = isTheme(look.theme) ? look.theme : DEFAULT_THEME;
  const accent = isAccent(look.accent) ? look.accent : DEFAULT_ACCENT;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  root.dataset.accent = accent;
  try {
    localStorage.setItem(THEME_MIRROR_KEY, JSON.stringify({ theme, accent }));
  } catch {
    // Not remembered: the next page opens in the default look for a moment.
  }
}

/** Puts the accent on a web page, for the ▶ buttons, chip, menus and video toolbar. */
export function applyPageAccent(accent: unknown, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(onPageAccentVars(accent))) root.style.setProperty(name, value);
}
