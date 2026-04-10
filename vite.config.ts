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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-reactflow': ['@xyflow/react'],
          'vendor-ui': ['@base-ui/react', 'lucide-react', '@dnd-kit/core', '@dnd-kit/utilities'],
          'vendor-tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-store',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-fs',
          ],
        },
      },
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
      ignored: ['**/tauri/**', '**/docs/**', '**/node_modules/**', '**/.git/**', '**/.superpowers/**', '**/dist/**', '**/overview.md', '**/README.md'],
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
