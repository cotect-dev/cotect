import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'

// Landing-only replacement for src/components/Canvas/nodes/cmLanguages.ts,
// wired in via the alias in vite.landing.config.ts. The desktop app ships
// highlighting for ~30 languages; the marketing demos only ever open the
// TypeScript files (and a package.json) in the seeded demo repo, so the full
// set would drag the largest Lezer grammars (cpp, php, rust, java, markdown,
// …) onto a phone for nothing. Limiting it to JS/TS + JSON cuts roughly a
// megabyte off the CodeNode chunk. Anything else falls through to null and
// renders as readable plain text, which is fine for a demo.
export function getLanguageExt(filePath: string): Extension | null {
  const ext = filePath.match(/\.([^./]+)$/)?.[1]?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true, jsx: ext === 'tsx' })
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext === 'jsx' })
    case 'json':
    case 'jsonc':
      return json()
    default:
      return null
  }
}
