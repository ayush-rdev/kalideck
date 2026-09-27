import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// Dev: `npm run dev:web` serves the UI on 5173 and proxies API/WS to the
// backend on 8080. Prod: `npm run build` emits dist/, served by the backend.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
})
