import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves in main.jsx (via the
      // virtual:pwa-register module) so we can control when it activates.
      injectRegister: null,
      // The manifest lives in public/site.webmanifest (the realfavicongenerator
      // set) and is linked from index.html, so the plugin must not generate a
      // competing /manifest.webmanifest.
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'favicon-96x96.png',
        'apple-touch-icon.png',
        'site.webmanifest',
        'web-app-manifest-192x192.png',
        'web-app-manifest-512x512.png',
      ],
      workbox: {
        // Deep links (e.g. /conversation/:jid) fall back to the SPA shell
        // offline; API routes are never served index.html.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Media is immutable and content-addressed — cache-first. Works
          // cross-origin because the API sends CORS * for GET /api/media/:id.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'media',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          // Never cache inbox data, threads or the SSE stream — the app has
          // its own IndexedDB layer for those.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      // Keep the dev server free of a stale service worker.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})