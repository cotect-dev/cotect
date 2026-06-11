import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Marketing site for cotect. Separate entry from the Tauri app (vite.config.ts)
// so the desktop bundle never ships landing assets and vice versa. It imports
// live editor components straight from src/ — the demos on the page are the
// real product code.
export default defineConfig({
  root: path.resolve(__dirname, 'landing'),
  // Branding SVGs are imported as modules; don't copy the app's public/
  // (tree-sitter wasm etc.) into the site bundle.
  publicDir: false,
  plugins: [react(), tailwindcss()],
  server: {
    // Dev-server access from LAN devices by hostname (phone testing).
    allowedHosts: ['grzracz-pc'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-landing'),
    emptyOutDir: true,
  },
})
