import { copyFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = (f) => resolve(root, 'public', f)
const mod = (pkg, f) => resolve(root, 'node_modules', pkg, f)

const files = [
  ['web-tree-sitter', 'tree-sitter.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
  ['tree-sitter-javascript', 'tree-sitter-javascript.wasm'],
]

for (const [pkg, file] of files) {
  try {
    copyFileSync(mod(pkg, file), pub(file))
  } catch {
    // Package not installed yet — skip silently
  }
}
