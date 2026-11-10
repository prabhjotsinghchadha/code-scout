# Code Scout — Chrome Extension

Spot video codes like `NSFS-484` on any website and open their trailer on javtrailers.com in a new tab, or on the other sites you use. Favourites, quick links and video tools too.

The extension's visible name and wording are kept neutral: *Code Scout*, *Search trailers*, and the bookmarks folder *Code Scout favourites*.

## Install

Code Scout isn't on the Chrome Web Store. It is installed from a zip, which takes a minute:

1. Download `code-scout-v….zip` from the [latest release](https://github.com/prabhjotsinghchadha/code-scout/releases/latest). Don't unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Drag the zip onto that page and drop it.

If the page doesn't take the zip: unzip it, put the folder somewhere it can stay (not Downloads, Chrome runs the extension from it), click **Load unpacked** and pick the folder.

Works the same in Edge, Brave and other Chromium browsers. Chrome may now and then ask whether to keep developer-mode extensions on: keep them.

### Updating

Chrome doesn't update an extension installed this way. The popup shows **Version … is out** when there is a newer release (it asks GitHub once a day, and sends nothing about you):

1. Press **Get it** and download the new zip.
2. Drop it on `chrome://extensions`, as before. (Or unzip it, **Load unpacked**, and pick the new folder.)

The new version takes the place of the old one, and your favourites and settings stay. Don't press **Remove** to update: removing the extension deletes its data (favourites are also kept in the bookmarks folder *Code Scout favourites*, and Settings can save everything to a file).

## Features

- **Type a code anywhere** — type `NSFS-484` (or `nsfs00484`) into any search box, comment field or editor on any site and a small chip appears under it: **▶ Open** or **Search**. Esc hides it.
- **▶ buttons on pages** — a small button appears next to every code shown on a page (also on content loaded later).
- **Open on other sites** — open any code on MissAV, JavLibrary, JavMost, Javtiful, Jav Guru, Jable, SupJav, BestJavPorn, SexTB (or sites you add with a `{code}` URL pattern): chip → *Sites ▾*, right-click a ▶ button, right-click menu → *Open “…” on*, the popup, or `Alt+Shift+L` for all sites at once.
- **Keyboard shortcuts** — select a code, or put the caret on one in a text box: `Alt+Shift+J` opens the trailer, `Alt+Shift+K` searches, `Alt+Shift+L` opens it on all your sites. Change them at `chrome://extensions/shortcuts`.
- **Hide what you're watching** — someone walks in: press `Alt+Shift+H` (or the eye button at the top of the popup). Every video in every tab pauses and leaves full screen and picture-in-picture; the tabs you were watching are muted and moved out of the tab strip into a minimised window showing a blank page. Press it again and they're back in the same windows and places, still paused, with the video where you left it. Hidden: the tab in front, tabs on your sites (javtrailers.com, your quick links' and "Open on" sites, sites with the pop-up blocker on), tabs playing sound or a video, and video pages (a code in the address or title). Your other tabs stay as they are.
- **Right-click menu** — on selected text: *Open trailer for "…"* / *Search trailers for "…"*. On links: *Open trailer for this link* takes the code from the link's address (`/videos/MD0273`, `/…/start-656-subs-…`), else from its text, its image's caption or the card it sits in (SexTB's `JUR-628-RM` badge, a SupJav title), so sites whose links are just an ID (`sextb.net/4ym025gij`, `supjav.com/312345.html`) work too. It never guesses a code from an ID's letters and digits; a link with no code anywhere searches javtrailers.com for its title.
- **What a video is** — a code alone says little, so the popup says what it stands for. The arrow at the end of a video's row (or →) opens its card: cover, title, release date and length, its performers, studio, series and genres, *More NSFS releases* (the same label), and **Watch on** with your sites, each saying what it's for. Click a performer, studio or genre to see more of it on javtrailers; press ♥ by a performer or # by a genre to keep it in your favourites. Once a video has been looked up, its row shows its title, performers and studio under the code, and the box finds it by any of them. The details are read from the video's page on javtrailers.com only when you ask: when you open a card or star a video in the popup, or when you're on its javtrailers page yourself (then from the page you're looking at, with no request). Nothing is fetched for codes that are merely listed. The last 400 are kept on this computer and are in the backup file. *Lists in the popup* under Settings → Appearance switches between *Detailed* (this) and *Compact* (codes only); nothing is out of reach in either.
- **Watch later** — a list apart from the favourites, for videos you mean to get to: *Watch later* in a video's card, or in the ▶ button's right-click menu on a page. They're in the popup under **Favourites → Later** (newest first; × takes one off). Kept on this computer (the last 500) and in the backup file.
- **Filters** — the funnel above Favourites, Later and Recent narrows the list to one label (the code's letters), performer or studio, picked from what the list has most of; the chip beside it shows what it's narrowed to and clears it. Performers and studios are offered for videos that have been looked up. Recent, by time, is in days (Today, Yesterday, Monday, 3 November). A video's card also has *Copy code*.
- **Starting points** — a new install's Links tab begins with a **Start here** group on javtrailers (new releases, genres, performers, studios, series, the release calendar) and the subtitle and site lists; the groups by taste that earlier installs came with (Cheating, Cuckold, NTR) aren't given to new ones, and an earlier install's links are left exactly as they are. Once you have favourites that have been looked up, the Links tab also shows **From your favourites**: the performers and studios you've starred most, each a click from their page.
- **Guide** — the **?** in the popup, or Settings → Guide: what a code is and how to read one, what ▶ ★ ✓ ♥ # mean, where things open and what each site is for, and the words you'll run into (label, studio, series, censored, subtitled, NTR…). It's there when you want it; nothing explains itself unasked. A new install with nothing saved gets one "New here?" card at the top of the popup; either of its buttons closes it for good, on all your devices, and installs from before it never see it.
- **Popup** — one box at the top. Type a code and press Enter to open it (Shift+Enter searches; the buttons under the box also star it or open it on your other sites). Type anything else and it finds it in every list at once: codes on the page, favourites and seen codes (by code, page title, or the video's title, performers and studio once looked up), starred pages, favourite performers and genres, quick links, and the performers, studios and genres of videos you've looked at. The last section is always **On the web**: *Search javtrailers for “…”* lists what the site finds right in the popup (cover, code, title), and a click opens that video's page; the pills in its heading switch the site searched between javtrailers and Jav Guru (remembered). Nothing is sent to a site until you press that row. Results with a code have ☆ and the card arrow like any other row. A pasted address that ends in a code counts as that code. Enter opens the first match, Esc clears the box. With the box empty, pick a tab: **This page** (every code on the current page), **Favourites**, **Recent** (codes you've seen) or **Links** (your quick links). It opens on This page when the page has codes, otherwise on the tab you used last. Click a row to open it: ▶ for a code (a grey ✓ once you've seen it), ♥ for a performer, # for a genre; Search and ☆ show after the row while you point at it, and the arrow opens its card. ↓ and ↑ move between the box and the rows. Along the bottom, the site you're on and its switches: *Buttons*, *Pop-ups* (block them) and *Video* (video tools). A video page whose address ends in its code (`18jav.tv/videos/MD0273`, `missav.ws/en/nsfs-484`) lists that code too, even when the page never writes it as `MD-0273`, so you can open or star it. On a tab opened before Code Scout was installed or updated, the popup reads the page itself, so This page still lists its codes; reload the tab for the ▶ buttons and video tools.
- **Favourite videos** — star a code with ☆ from the ▶ button's right-click menu, the chip, the popup (after a code's row, or under the box for the one you type), or right-click → *Add “…” to favourites*. To star the page you're on, even one with no code, use *Star this page* in the popup's Favourites tab or right-click the page → *Add this page to favourites* (if its address ends in a code, like `/videos/MD0273`, that code is starred with the page). A copy is kept in the bookmarks folder *Code Scout favourites* (a folder from before the rename, *JAV Trailer Opener favourites*, is found and renamed), which stays when the extension is removed: after a reinstall, or whenever you have no favourites, they come back from it (with bookmark sync on, the folder is in your Google account too). Un-starring removes its bookmark; nothing else is taken out of the folder. Starred codes show as ★ on pages and in the popup's **Favourites** list (newest first) with Search and Sites, plus a link back to the page you starred them on (only saved when the code is shown on that page, not just typed). Favourites sync across your Chrome devices; about 500 fit.
- **Seen codes** — codes you open from Code Scout (Open, Search, Open on), and codes whose video page you visit (an address ending in the code, like `missav.ws/en/nsfs-484`; search pages don't count), get a grey ✓ instead of ▶ on pages, so the ones you haven't watched stand out (a favourite keeps its ★). Point at the ✓, or right-click it, to see when. The popup's **Recent** tab lists them newest first with when, the page you saw each one on, Search, Sites and ☆, and × to forget one; codes in This page and Favourites get a ✓ too. Past the 100 most recent, the popup's box finds the rest. Kept on this computer only (the last 2,000), never from incognito windows; switch it off or clear it in Settings → On pages.
- **Favourite performers** — right-click an actress's name link (her page, like `/actresses/…`, `/casts/…`, `/models/…`, `/actress/…`, `/star/…`) → *Add this performer to favourites*, select a name and right-click → *Add “…” to favourite performers*, or type a name into the popup's **Favourites → Performers** box and press Enter. Click one to open the page you saved her from, or to search javtrailers.com for her name. Wherever a favourite actress's name appears on a page (either name order, e.g. *Mikami Yua*), a violet ♥ follows it (a heart, so it isn't mistaken for a starred code's ★); click it to open her page. The ♥ marks come and go with the ▶ buttons. Actresses sync like the favourite videos (sharing the ~500 limit) and are backed up in an *Actresses* folder inside *Code Scout favourites*.
- **Favourite genres** (tags) — right-click a tag link (`…/categories/cheating-wife`, `…/genres/NTR`, `…/category/affair`, `…/tag/…`) → *Add this genre to favourites*, or type one into **Favourites → Genres**. Saving the same tag from another site adds that site's page to it, so *NTR* gathers its pages from MissAV, javtrailers, Javtiful… and one click opens it on all of them (a tag with no page yet searches javtrailers.com). Each page shows as a chip under the tag; right-click a chip to take it off. Links to a favourite tag's page get a teal **#** at the end (tag links only: the word *affair* in a title is left alone). Tags sync like the other favourites and are backed up in a *Tags* folder inside *Code Scout favourites*, a bookmark per page.
- **Quick links in groups** — the popup's **Links** tab shows your sites and category pages as rows under their group: each site's icon (Chrome's own saved copy; a coloured letter when it has none), the page's name, and the site at the right. Click a group's name to fold it away (the popup remembers which are folded); point at a group for **Open all**. Drag a row by the handle at its left edge to reorder it or move it to another group, right there in the popup; right-click a row (or its ⋯) to rename it, move it or remove it (with Undo). The sort button offers *My order*, *Most visited* and *A–Z* (dragging is for *My order*). The box at the top of the popup finds any link by name, site or group. *Add this page* saves the page you're on to the group you saved to last, or another, or a new one. It's named like the built-in links (*Jav Guru · English subbed*), with the page's part selected so you can type what it is — handy when you keep several pages of one site, like a category sorted two ways. **Most visited**, the row of big icons at the top, is the four sites you open most, from visits to your quick-link sites counted on this computer (older visits count for less; switch it off or clear the history in Settings). In Settings each group is a card: drag links by their handle to reorder them or move them between groups, drag groups to reorder them, rename anything in place and add links straight into a group. Comes with built-in links in groups — Cheating, Cuckold, All Japanese (FapHouse, Pornhub, YouPorn), Subtitles (MissAV, Jav Guru, 18JAV, SupJav, BestJavPorn) and More sites (Jable, SexTB, 7MMTV, Korean Porn Movie, ThePornDude) — edit or remove freely.
- **Appearance** — Settings → Appearance: *Match system*, *Light* or *Dark*, and an accent colour (rose, orange, green, blue, purple or graphite) with a preview. It changes the popup and Settings at once, and the colour of what's drawn on pages (▶ buttons, the chip's Open, the video toolbar's lit buttons); a favourite's ★, a seen code's ✓, an actress's ♥ and a tag's # keep their own colours so they stay apart. The popup and Settings are set in Geist (codes in Geist Mono), which comes with the extension; nothing is fetched online. The look syncs and is in the backup file.
- **Sorting** — each list in the popup has a sort button at its top right: *This page* (page order, unseen first, code A–Z), *Favourites* and *Recent* (newest, oldest, code A–Z), actresses and tags (newest, A–Z), *Links* (my order, most visited, A–Z). The button is lit while a list isn't in its usual order, and each list's choice is remembered on this computer.
- **Settings** — what "Open" does (direct video page by default, or search page), background tabs, and turning the chip or ▶ buttons off everywhere, plus every per-site list, "Open on" site, quick link and shortcut. One section shows at a time, picked from the list on the side (Look · Finding videos · Watching · More); *Search settings* above the list shows every section that mentions what you type (Esc clears it).
- **Backup** — Settings → Backup: *Export to a file* saves everything Code Scout keeps as one JSON file (`code-scout-backup-2026-11-10.json`): settings, quick links and sites, favourite videos, actresses and tags, seen codes, visit counts and the subtitle file picked for each video. *Import from a file…* brings one back, after a reinstall or on another computer: the settings, quick links and sites become the file's; favourites, seen codes and subtitle choices are added to what's there (a code seen in both keeps the later time), and nothing is removed. Every entry in the file is checked, and ones that aren't Code Scout's are left out.
- **Off on this site** — turn the ▶ buttons and chip off for one site (and its subdomains) with *Buttons* in the popup, or manage the list in Settings. Right-click and shortcuts keep working there.
- **Ad-click shield** — clicks and keys on the extension's own ▶ buttons, chip and menu are hidden from the page, so a site's pop-under ad scripts can't open ad tabs when you use them. (Clicks on the site's own player or links still go to the site — see the pop-up blocker below.)
- **Pop-up blocker (per site)** — switch on *Pop-ups* in the popup (or list sites in Settings), then reload. On those sites it stops `window.open` pop-ups/pop-unders, invisible ad-overlay links to other sites, scripted new-tab clicks, and the "tab-under" trick (the video opens in a new tab while this tab is redirected to an ad). The site's own pages still open — if the site opened one by script after your click, the extension re-opens it. Ctrl/⌘/middle-click and *Open link in new tab* always work. Any other new tab the site still manages to open is closed. The toolbar badge counts what was blocked on the page. It also covers video players the site embeds from other sites (the ad overlays on jav.guru's players, say).
- **Video tools** — on every site by default (switch them off everywhere in Settings, or per site with *Video* in the popup). Videos get a small toolbar at the top right while you point at them or while they're paused (the page's main video has it from the start, and keeps a faint ⚡ in the corner while it plays); it moves aside if another extension's controls are in that corner. Players embedded from other sites get it too (jav.guru's video servers, say); there the page around the player shows *Save as*, names the file and translates the subtitles, since Chrome doesn't let such a frame do those itself:
  - **⚡ faster loading** for HLS videos (`.m3u8`), whatever the player: hls.js, JW Player, Video.js, Shaka, or a player that bundles hls.js inside it (as most embedded video servers do). Each piece of the video is downloaded as several parallel byte ranges, and the next 10 minutes are fetched ahead (at most 250 MB), also while the video is paused, so pausing lets it load further; the player gets them from memory. Not for live streams, or for plain MP4 files the browser plays by itself. On 18JAV, whose server sends each request at about 50 KB/s, the player now buffers about 4× faster than the video plays instead of stalling. The ⚡ number shows how far ahead it has loaded.
  - **720p ▾**, the quality playing, with a menu when the stream has more than one quality (players other than the page's own hls.js keep their own quality menu; the toolbar shows the quality playing); a plain *720p* label when it has only one (as on 18JAV). Download saves the quality you picked, or the best one.
  - **⬇** (Download) saves the video as an MP4 (`PMX-046.mp4`): a "Save as" dialog, then the stream is downloaded in parallel and repackaged as MP4 (no re-encoding) straight into the file. It starts with 6 requests at once and tries more (up to 24), keeping them only while they make it faster; the button shows how far it is and the time left, and its tooltip the live speed and how many requests are running. While it runs, faster loading (⚡) fetches only a little ahead, and the download's requests yield to the playing video's; pausing the video leaves the download the most speed. Keep the tab open while it runs; if the video's link expires mid-download, a fresh one is fetched from the page. Encrypted and live streams can't be saved.
  - **« 1.00 » speed**: « and » make the video a step (0.25) slower or faster, from 0.25 to 4.00, and the number between them puts it back to 1.00; click it again for the speed you had. The **picture-in-picture** button (a screen with a small window in its corner) puts the video in its own small window (picture-in-picture) that stays on top while you use other tabs.
  - **Player keys** for the video you're watching, the same on every site's player: `Space` or `K` play and pause, `←` `→` 5 seconds, `J` `L` 10 seconds, `,` `.` one frame back or on (pausing it), `<` `>` a step slower and faster, `M` mute, `P` picture-in-picture. A key the extension takes never reaches the site's own player or its ad scripts, so one press is one seek. They work once a video has played with sound, or while the pointer is on it or it's full screen; until then the keys stay the page's (J and K still move through a feed whose previews play muted, space still scrolls), and never while you type or with Ctrl/⌘/Alt. In a player embedded from another site, click the player first, so the keys go to it. Switch them off in Settings → Video tools.
  - **Toolbar messages** ("Quality: 720p", "Saved …", what a key did, errors) are off by default; switch them on in Settings → Video tools.
  - **CC ▾** is the one button for subtitles. Its first line, **EN subs**, reads Chinese or Japanese subtitles burned into the picture, on this computer (PaddleOCR in an offscreen page), and covers them with an English line from Chrome's built-in translator (Chrome 138+; the first use downloads Chrome's language models, or use *Set up English subtitles* in Settings). Text size and background (solid to see-through) are in Settings.
  - Under it in the **CC ▾** menu, for videos with no subtitles in the picture: subtitle files for the video's code (taken from the page's address or title; type another into the menu's box and press Enter). It lists what [SubtitleCat](https://www.subtitlecat.com) has for the code, English ones first, with downloads and 👍 for files its users rated good; pick one and its lines show over the video, in time with it, with the same text size and background as EN subs. A file only in Japanese or Chinese shows as it is until Chrome's translator is ready, then in English, translated a little ahead of the video. *Load a file from this computer…* shows an `.srt`, `.vtt` or `.ass` file you have (UTF-8, Shift-JIS or GBK), such as one from [javsub.ai](https://javsub.ai): *Find on javsub.ai ↗* opens the code there (it doesn't let the extension download its files itself). A file made from another cut of the video can be out of time: **◀ Earlier** / **Later ▶** in the menu move the lines by half a second, and the file you picked and its timing are remembered for that code (on this computer), so it comes back in time next time. Only one English line at a time: CC and EN subs turn each other off.

Built with **Vite + TypeScript** and [CRXJS](https://crxjs.dev/) (Manifest V3).

## Structure

```
manifest.config.ts     # Manifest V3 definition (typed)
vite.config.ts
public/icons/          # Extension icons (placeholders)
public/theme-boot.js   # Puts the look on an extension page before it's drawn
src/
  background/          # Service worker
  background/hide.ts   # Hide what you're watching, and bring it back; shared/hide.ts picks the tabs (unit-tested)
  content/             # Content scripts (run on web pages)
  content/shield.iife.ts  # Runs at document_start: hides clicks on our UI from page scripts
  content/popup-block.iife.ts  # Pop-up blocker, page side (registered per site at runtime)
  content/video-boost.iife.ts  # Video tools, page side: parallel loading for any HLS player (+ quality for hls.js)
  content/video-tools.ts       # Video tools toolbar; video-download.ts (MP4 download), subs.ts (EN subs)
  content/cc-menu.ts           # CC menu: subtitle files for the video; subtitle-file.ts shows one in time with it
  content/frame.ts             # In frames (embedded players): video tools + pop-up blocker; frame-bridge.ts asks the page to save/translate
  offscreen/           # Offscreen page that runs the subtitle OCR model (and translation fallback)
  popup/               # Toolbar popup UI: main.ts (the box, tabs, code rows), rows.ts (what a row is made of), one file per list (links.ts: rows, folding, dragging)
  options/             # Options page
  shared/codes.ts      # Code detection + javtrailers URL building (unit-tested)
  shared/favourites.ts # Favourite videos, one synced key per code or page (fav:NSFS-484, favurl:https://…)
  shared/seen.ts       # Codes already seen (opened, or their video page visited), in local storage (unit-tested)
  shared/actresses.ts  # Favourite actresses, one synced key per name (actress:yua mikami), and finding their names in text
  shared/tags.ts       # Favourite tags, one synced key per tag (tag:ntr) with its pages on each site
  shared/names.ts      # Tidying and comparing the names of favourite actresses and tags
  shared/fav-backup.ts # Copy of the favourites in a bookmarks folder, restored after a reinstall
  shared/theme.ts      # The look: themes and accents, for the extension's pages (ui.css) and for pages (content.css); look.ts keeps a page in it
  popup/sort.ts        # How the popup's lists are sorted (unit-tested)
  shared/later.ts      # Watch later: codes put aside, kept like the seen codes
  popup/filter.ts      # Narrowing a list to a label, performer or studio (unit-tested)
  shared/details.ts    # What a code is: reading a javtrailers video page (unit-tested), and the kept details; popup/details.ts shows them
  shared/data-file.ts  # Export and import: everything in one JSON file, checked entry by entry on the way in (unit-tested)
  shared/sites.ts      # Built-in sites: each one's "Open on" pattern and quick-link pages, defined once
  shared/seed.ts       # Offers new built-ins to each install once, so ones the user removed stay removed
  shared/hls-playlist.ts, range-fetch.ts, parallel-tuner.ts, subtitles.ts  # Video tools helpers (unit-tested)
  shared/srt.ts, subtitle-cat.ts  # Reading subtitle files, and SubtitleCat's pages (unit-tested); background/subtitle-search.ts fetches them
scripts/prepare-ocr.mjs  # Fetches the OCR models into public/ocr/ before dev/build (git-ignored)
  shared/              # Typed messaging + storage helpers
```

## Adding a built-in site

Add an entry to `SITES` in `src/shared/sites.ts`, or a page to an existing site's `pages`. Every install gets
it on its next update; there is no version to bump. Installs remember items by id, so never rename or reuse
an id. `npm test` checks the registry: unique ids, valid URLs and "Open on" patterns, and known groups.
A page in a group listed in `GROUP_AUDIENCE` goes only to new installs ("Start here") or only to ones from
before there were starting points (the groups by taste); every other page goes to all.

```ts
{
  id: 'example',
  name: 'Example',
  origin: 'https://example.com',
  openOn: '/search?q={code_lower}',  // optional: adds it to "Open on"
  pages: [{ id: 'subs', label: 'English subtitles', path: '/category/subs', group: 'Subtitles' }],
},
```

## Development

```bash
npm install
npm run dev
```

The first `npm run dev` or `npm run build` downloads the subtitle OCR models (about 23 MB) into
`public/ocr/`. With them and ONNX Runtime's WebAssembly, the extension is about 38 MB.

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
```

## Releasing a version

Code Scout is shared as a zip on GitHub Releases (see [Install](#install)).

1. Raise `version` in `package.json`.
2. Build the zip, then publish it with a tag `v` + that version (the notice compares the tag with the installed version):

```bash
npm run release  # outputs release/code-scout-v<version>.zip
gh release create v0.2.0 release/code-scout-v0.2.0.zip --title "Code Scout 0.2.0" --notes "What changed"
```

The notice reads the releases of `RELEASES_REPO` in `src/shared/update.ts`.

The release build goes to `release/`, not `dist/`, and its manifest carries a fixed `key`, so everyone's copy has the same extension ID wherever it is loaded from: a newer copy from another folder replaces the old one and keeps its data. `manifest.json` is at the top level of the zip, which is what Chrome needs to take a dropped zip. `dist/` has no key on purpose: adding one to a folder already loaded in Chrome changes its ID and empties its storage.
