/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { developerDocs } from './developers/plugin.mjs';
import { devCspPreamble } from './src/build/devCsp';
import { PRECACHE_GLOB_PATTERNS, PRECACHE_MAX_FILE_BYTES } from './src/build/precache';
import { VISION_DIRECTORY, visionAssets } from './src/build/visionAssets.mjs';

export default defineConfig({
  plugins: [
    devCspPreamble(),
    react(),
    developerDocs(),
    visionAssets(),
    VitePWA({
      // 'prompt' keeps a new build waiting until SwAutoUpdate applies it, so an
      // update never reloads the page out from under a live voice session.
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/favicon-16.png', 'icons/apple-touch-icon.png'],
      manifest: {
        // The server answers /manifest.webmanifest with the instance's own name
        // (see packages/server/src/utils/webDocument.ts); these are the fallbacks.
        name: 'Tavvit',
        short_name: 'Tavvit',
        description: 'A home for your friends and communities: channels, direct messages, voice and screen sharing.',
        display: 'standalone',
        start_url: '/',
        theme_color: '#0d0e11',
        background_color: '#0d0e11',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // /downloads: the desktop installers and the updater's latest.yml are
        // files from the server, never the app's page (routes/desktopDownloads.ts).
        // /developers: the docs are pages of the server's; only /developers/bots
        // is the app (docs/systems/developers.md).
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/ws/,
          /^\/uploads/,
          /^\/downloads\//,
          /^\/developers\/?$/,
          /^\/developers\/(?:docs|assets)(?:\/|$)/,
          /^\/\.well-known\//,
        ],
        // The camera effects' WebAssembly (src/build/visionAssets.mjs) loads
        // only when someone turns an effect on, never with the app.
        globIgnores: ['**/node_modules/**/*', 'developers/**', `${VISION_DIRECTORY}/**`],
        // No skipWaiting: a new worker activates only on SwAutoUpdate's
        // SKIP_WAITING message. The one exception is replacing a worker from
        // before that flow, which public/sw-rollover.js handles.
        // clientsClaim only matters on the first install, where there is no
        // older worker to replace.
        // sw-push.js shows a push while the app is closed (docs/systems/push.md).
        importScripts: ['sw-rollover.js', 'sw-push.js'],
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The precached file types; the CI size check reads the same list.
        globPatterns: PRECACHE_GLOB_PATTERNS,
        // CI fails when a precached file nears this limit; see src/build/precache.ts.
        maximumFileSizeToCacheInBytes: PRECACHE_MAX_FILE_BYTES,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.json'],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3005',
        ws: true,
      },
      '/downloads': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
      // The docs, from the last build. /developers/bots stays the app.
      '^/developers(?:/|/docs(?:/.*)?|/assets/.*)?$': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },
});
