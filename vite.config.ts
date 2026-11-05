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
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
