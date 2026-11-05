import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Code Scout',
  description: 'Spot catalogue codes on any page and open them in one click, with favourites, quick links and video tools.',
  version: pkg.version,
  icons: {
    16: 'icons/icon-16.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      48: 'icons/icon-48.png',
    },
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      // Must run before page scripts: a plain IIFE (not the async module loader) at document_start.
      matches: ['<all_urls>'],
      js: ['src/content/shield.iife.ts'],
      run_at: 'document_start',
    },
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      css: ['src/content/content.css'],
      run_at: 'document_idle',
    },
  ],
  // scripting + host access: the pop-up blocker's and video tools' page scripts are registered per site
  // at runtime, and the backstop reads which site opened a new tab. (Content scripts already run on all
  // sites.) offscreen: the page that reads and translates subtitles (OCR model in WebAssembly).
  // bookmarks: favourites are backed up to a bookmarks folder, which survives removing the extension.
  permissions: ['storage', 'contextMenus', 'activeTab', 'scripting', 'offscreen', 'bookmarks', 'favicon'],
  // 'wasm-unsafe-eval': lets extension pages run WebAssembly (the subtitle OCR model). No other code.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  host_permissions: ['<all_urls>'],
  commands: {
    'open-trailer': {
      suggested_key: { default: 'Alt+Shift+J' },
      description: 'Open trailer for the selected or typed code',
    },
    'search-trailer': {
      suggested_key: { default: 'Alt+Shift+K' },
      description: 'Search trailers for the selected or typed code',
    },
    'open-on-all': {
      suggested_key: { default: 'Alt+Shift+L' },
      description: 'Open the selected or typed code on all your "Open on" sites',
    },
  },
});
