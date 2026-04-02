import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**'],
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
