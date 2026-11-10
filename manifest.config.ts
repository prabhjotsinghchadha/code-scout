import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// The copy shared with other people (`npm run release`) carries a fixed public key, so it has the same
// extension ID (nmnkppdmepnlhdbicgkhegamnapkgmnb) wherever its folder is unzipped: without one, Chrome
// derives the ID of an unpacked extension from its folder's path, and moving or renaming the folder
// starts again with empty storage. Only in release mode: a folder already loaded without the key (a
// developer's dist/) would change ID, and lose its data, the moment the key appeared.
// No private key is kept: one is only needed to pack a .crx, which Chrome doesn't install anyway.
const RELEASE_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvlkNXvpOv0auvcF+3ZiOu5M039mzcS+o8OPNgAY5LGfmWauANLWoqou4XAKU4F9rgTK7H1Dge7NhDarFLm2JNdk/uXKqnDEUEz9q7bW6VL3rZnhU89D1f8oVp0EkBtNQgxdnjPWLXL84xYnqJvVyXO7BHHN7y2Pz+7eBzs0p1hRXrEzEfyxDefWOaUUUTL4sN+rwQ5DfF8TubijxkwBKwireX+hGo3BYZedIuQJqAguR+C3IpHptxvBzLrUTDADuoi0yrNOerFh2zpjWqIAsee8IvNQqj/4NssEgUVSTjsO6xMIVUwIF6DIK8xt9R7g3mW4aZ1M6RX6xrC7XBjQlkQIDAQAB';

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  ...(mode === 'release' ? { key: RELEASE_KEY } : {}),
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
      // In frames too: the video toolbar also goes on players embedded from other sites.
      matches: ['<all_urls>'],
      js: ['src/content/shield.iife.ts'],
      run_at: 'document_start',
      all_frames: true,
    },
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      css: ['src/content/content.css'],
      run_at: 'document_idle',
    },
    {
      // Frames (players embedded from other sites): video tools and the pop-up blocker. Does nothing on the page itself.
      matches: ['<all_urls>'],
      js: ['src/content/frame.ts'],
      css: ['src/content/content.css'],
      run_at: 'document_start',
      all_frames: true,
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
    'hide-watching': {
      suggested_key: { default: 'Alt+Shift+H' },
      description: 'Hide what you’re watching (pause, mute, tabs out of sight); again to bring it back',
    },
    'open-on-all': {
      suggested_key: { default: 'Alt+Shift+L' },
      description: 'Open the selected or typed code on all your "Open on" sites',
    },
  },
}));
