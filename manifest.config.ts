import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'JAV Trailer Opener',
  description: 'Spot video codes like NSFS-484 on any page and open their trailer on javtrailers.com in a new tab.',
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
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      css: ['src/content/content.css'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'contextMenus', 'activeTab'],
  commands: {
    'open-trailer': {
      suggested_key: { default: 'Alt+Shift+J' },
      description: 'Open trailer for the selected or typed code',
    },
    'search-trailer': {
      suggested_key: { default: 'Alt+Shift+K' },
      description: 'Search javtrailers.com for the selected or typed code',
    },
    'open-on-all': {
      suggested_key: { default: 'Alt+Shift+L' },
      description: 'Open the selected or typed code on all your "Open on" sites',
    },
  },
});
