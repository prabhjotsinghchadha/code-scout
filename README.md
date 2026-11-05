# JAV Trailer Opener — Chrome Extension

Spot video codes like `NSFS-484` on any website and open their trailer on javtrailers.com in a new tab.

## Features

- **Type a code anywhere** — type `NSFS-484` (or `nsfs00484`) into any search box, comment field or editor on any site and a small chip appears under it: **▶ Open** or **Search**. Esc hides it.
- **▶ buttons on pages** — a small button appears next to every code shown on a page (also on content loaded later).
- **Keyboard shortcuts** — select a code, or put the caret on one in a text box: `Alt+Shift+J` opens the trailer, `Alt+Shift+K` searches. Change them at `chrome://extensions/shortcuts`.
- **Right-click menu** — on selected text: *Open trailer for "…"* / *Search javtrailers for "…"*. On links: looks for a code in the URL.
- **Popup** — type a code (Open / Search), see every code on the current page, and your **Quick links**.
- **Quick links** — save sites or category pages you visit often (*+ Add this page* in the popup, or Settings) and open them in one click.
- **Settings** — what "Open" does (direct video page by default, or search page), background tabs, turn the chip or ▶ buttons off.

Built with **Vite + TypeScript** and [CRXJS](https://crxjs.dev/) (Manifest V3).

## Structure

```
manifest.config.ts     # Manifest V3 definition (typed)
vite.config.ts
public/icons/          # Extension icons (placeholders)
src/
  background/          # Service worker
  content/             # Content script (runs on web pages)
  popup/               # Toolbar popup UI
  options/             # Options page
  shared/codes.ts      # Code detection + javtrailers URL building (unit-tested)
  shared/              # Typed messaging + storage helpers
```

## Development

```bash
npm install
npm run dev
```

Then load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and pick the `dist/` folder

While `npm run dev` is running, changes hot-reload (popup/options) or auto-reload the extension (background/content).

## Tests

```bash
npm test
```

## Production build

```bash
npm run build    # outputs dist/
npm run zip      # builds and creates extension.zip for the Chrome Web Store
```
