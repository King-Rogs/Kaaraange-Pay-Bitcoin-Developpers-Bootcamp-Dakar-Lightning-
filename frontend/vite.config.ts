import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, l'API Flask tourne sur :5000 — Vite lui relaie /api et /uploads
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/uploads': 'http://127.0.0.1:5000',
    },
  },
})
