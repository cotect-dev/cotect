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
  // Relative asset paths: the site must work both at the GitHub Pages
  // project subpath and at the cotect.dev root.
  base: './',
  // Branding SVGs are imported as modules; don't copy the app's public/
  // (tree-sitter wasm etc.) into the site bundle. landing/public holds the
  // site-only static assets (og.png for link previews).
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  server: {
    // Dev-server access from LAN devices by hostname (phone testing).
    allowedHosts: ['grzracz-pc'],
  },
  resolve: {
    // Array form so the cmLanguages override is matched before the general
    // '@' prefix. The demos open only TS/JSON, so swap the app's ~30-language
    // syntax registry for a JS/TS+JSON subset and keep the heavy Lezer
    // grammars (cpp, php, rust, markdown, …) off the marketing bundle.
    alias: [
      {
        find: '@/components/Canvas/nodes/cmLanguages',
        replacement: path.resolve(__dirname, './landing/cmLanguagesLite.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-landing'),
    emptyOutDir: true,
  },
})
