import path from 'path'
import fs from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function serveNeutralinoGlobals(): Plugin {
  return {
    name: 'serve-neutralino-globals',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/__neutralino_globals.js') {
          // In dev, serve the generated globals with connection details
          const devPath = path.resolve(__dirname, 'dist/__neutralino_globals_dev.js')
          const prodPath = path.resolve(__dirname, 'dist/__neutralino_globals.js')
          const filePath = fs.existsSync(devPath) ? devPath : prodPath
          try {
            const content = fs.readFileSync(filePath, 'utf-8')
            res.setHeader('Content-Type', 'application/javascript')
            res.setHeader('Cache-Control', 'no-store')
            res.end(content)
          } catch {
            // Globals not ready yet — return empty script
            res.setHeader('Content-Type', 'application/javascript')
            res.end('// Neutralino globals not available yet')
          }
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serveNeutralinoGlobals()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/llm': {
        target: 'http://server.local:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
    },
  },
})
