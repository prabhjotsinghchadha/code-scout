# Jav — Chrome Extension

Manifest V3 Chrome extension built with **Vite + TypeScript** and [CRXJS](https://crxjs.dev/).

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

## Production build

```bash
npm run build    # outputs dist/
npm run zip      # builds and creates extension.zip for the Chrome Web Store
```
