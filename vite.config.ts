import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    // The OCR library imports onnxruntime-web; its WebAssembly-only build is all the subtitle reader
    // needs (the default one also bundles WebGPU/WebGL code).
    alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
  },
  build: {
    rollupOptions: {
      // Not named in the manifest (the background opens it), so CRXJS needs to be told about it.
      input: { offscreen: 'src/offscreen/index.html' },
      // Same file names in every build (no content hashes). Chrome keeps an unpacked extension's
      // content-script loaders from when it was last reloaded, and they import the code by file name:
      // with hashed names, every rebuild of dist/ deleted the files they import, and Code Scout stopped
      // working on new pages (no buttons, no video toolbar) until the extension was reloaded.
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
