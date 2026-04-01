import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    watch: {
      ignored: ['**/src-tauri/**', '**/docs/**', '**/node_modules/**', '**/.git/**', '**/.superpowers/**', '**/dist/**', '**/overview.md', '**/README.md'],
    },
    strictPort: true,
    proxy: {
      '/llm': {
        target: 'http://server:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
    },
  },
})
