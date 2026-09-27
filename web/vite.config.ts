/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Same origin for everything: the dev server proxies /api to FastAPI and /auth to
// Authentik (docs/06 §6.3, docs/10 §10.2).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TCFL Portal',
        short_name: 'TCFL',
        description: 'TelOne Centre for Learning student portal',
        theme_color: '#FAF9F7',
        background_color: '#FAF9F7',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      // Authentik runs with AUTHENTIK_WEB__PATH=/auth/. Keep the browser's Host header
      // (changeOrigin: false) so Authentik issues tokens for http://localhost:5173/auth/….
      '/auth': {
        target: process.env.AUTH_PROXY_TARGET ?? 'http://localhost:9000',
        changeOrigin: false,
        xfwd: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
