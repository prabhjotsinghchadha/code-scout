# JAV Trailer Opener — Chrome Extension

Spot video codes like `NSFS-484` on any website and open their trailer on javtrailers.com in a new tab.

## Features

- **▶ buttons on pages** — a small button appears next to every code found on a page (also on content loaded later). Click it to open the trailer.
- **Right-click menu** — select any text (`NSFS-484`, `nsfs00484`, `NSFS 484`) → *Open trailer for "…"*. Also works on links whose URL contains a code.
- **Popup** — lists every code on the current page, plus a box to type one in.
- **Settings** — open the video page directly (`/video/nsfs00484`, default) or the search page (`/search/nsfs-484`), open in a background tab, turn the inline buttons off.

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
