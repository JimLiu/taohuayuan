import { defineConfig } from 'vite';
// dist/: index.html, and everything else in assets/ with a content hash in its name (script, style, textures,
// models, the recitation), so a server can let browsers keep them for good. three.js goes in a file of its own:
// it changes far less often than the scene's code.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5178 },
});
