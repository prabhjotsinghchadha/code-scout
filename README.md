# JAV Trailer Opener — Chrome Extension

Spot video codes like `NSFS-484` on any website and open their trailer on javtrailers.com in a new tab.

## Features

- **Type a code anywhere** — type `NSFS-484` (or `nsfs00484`) into any search box, comment field or editor on any site and a small chip appears under it: **▶ Open** or **Search**. Esc hides it.
- **▶ buttons on pages** — a small button appears next to every code shown on a page (also on content loaded later).
- **Open on other sites** — open any code on MissAV, JavLibrary, JavMost, Javtiful, Jav Guru, Jable (or sites you add with a `{code}` URL pattern): chip → *Sites ▾*, right-click a ▶ button, right-click menu → *Open “…” on*, the popup, or `Alt+Shift+L` for all sites at once.
- **Keyboard shortcuts** — select a code, or put the caret on one in a text box: `Alt+Shift+J` opens the trailer, `Alt+Shift+K` searches, `Alt+Shift+L` opens it on all your sites. Change them at `chrome://extensions/shortcuts`.
- **Right-click menu** — on selected text: *Open trailer for "…"* / *Search javtrailers for "…"*. On links: looks for a code in the URL.
- **Popup** — type a code (Open / Search), see every code on the current page, and your **Quick links**.
- **Quick links in groups** — save sites or category pages (*+ Add this page* in the popup picks a group, or create a new one), organized into collapsible groups like Cheating / Cuckold / NTR / All Japanese, each with **Open all**. Rename, reorder and regroup in Settings. Comes with a few built-in links (MissAV, Jav Guru English subbed, 18JAV Chinese subtitle, Jable, JavLibrary, JavMost, Javtiful, JavTrailers categories, Beeg, and Japanese sections of FapHouse, Pornhub, YouPorn) — edit or remove freely.
- **Settings** — what "Open" does (direct video page by default, or search page), background tabs, turn the chip or ▶ buttons off.
- **Off on this site** — turn the ▶ buttons and chip off for one site (and its subdomains) from the popup, or manage the list in Settings. Right-click and shortcuts keep working there.
- **Ad-click shield** — clicks and keys on the extension's own ▶ buttons, chip and menu are hidden from the page, so a site's pop-under ad scripts can't open ad tabs when you use them. (Clicks on the site's own player or links still go to the site — see the pop-up blocker below.)
- **Pop-up blocker (per site)** — tick *Block pop-ups on this site* in the popup (or list sites in Settings), then reload. On those sites it stops `window.open` pop-ups/pop-unders, invisible ad-overlay links to other sites, scripted new-tab clicks, and the "tab-under" trick (the video opens in a new tab while this tab is redirected to an ad). The site's own pages still open — if the site opened one by script after your click, the extension re-opens it. Ctrl/⌘/middle-click and *Open link in new tab* always work. Any other new tab the site still manages to open is closed. The toolbar badge counts what was blocked on the page.

Built with **Vite + TypeScript** and [CRXJS](https://crxjs.dev/) (Manifest V3).

## Structure

```
manifest.config.ts     # Manifest V3 definition (typed)
vite.config.ts
public/icons/          # Extension icons (placeholders)
src/
  background/          # Service worker
  content/             # Content scripts (run on web pages)
  content/shield.iife.ts  # Runs at document_start: hides clicks on our UI from page scripts
  content/popup-block.iife.ts  # Pop-up blocker, page side (registered per site at runtime)
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
