// The public website: the product page at `/` and the pages anyone can read (`/status`, `/help`,
// `/changelog`, `/roadmap`), rendered to HTML when the web package is built, so that a link preview,
// a search engine and a visitor without a script all get the page itself and not an empty shell.
// docs/systems/landing.md, "How it is built".
//
// Astro renders the same React components the app's bundle has (src/landing, src/publicPages);
// nothing about the app changes. `site/build.mjs` runs this build after Vite's and moves what it
// writes into the web build, where the server sends it (utils/webDocument.ts).
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  srcDir: './site',
  // The web package's own `public/`, so that the stylesheets' `/fonts/...` resolve while building.
  // Vite's build already puts it into dist; site/build.mjs drops Astro's second copy.
  publicDir: './public',
  outDir: './dist-site',
  cacheDir: './node_modules/.astro',
  build: {
    // `/status` is written as `status.html`, the name the server looks for (shared/src/site.ts).
    format: 'file',
    // Every stylesheet a file of its own and never a <style> block, every script a file of its
    // own: the server's policy allows scripts from this origin only (utils/csp.ts).
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Nothing is turned into a data: URL or an inline script, however small.
      assetsInlineLimit: 0,
      rolldownOptions: {
        // The English changelog is read at once by the public pages and lazily by the product
        // page's newest line; it stays a chunk of its own either way, so the notice says nothing.
        checks: { ineffectiveDynamicImport: false },
      },
    },
    server: {
      // `pnpm --filter @backspace/web site:dev`: the API of a local server, as Vite's dev server has it.
      proxy: { '/api': 'http://localhost:3005' },
    },
  },
  integrations: [react()],
  devToolbar: { enabled: false },
  compressHTML: true,
});
