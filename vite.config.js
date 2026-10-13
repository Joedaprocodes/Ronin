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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WhatsApp Inbox',
        short_name: 'Inbox',
        description: 'Offline-first WhatsApp inbox',
        start_url: '/',
        display: 'standalone',
        background_color: '#111b21',
        theme_color: '#111b21',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
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