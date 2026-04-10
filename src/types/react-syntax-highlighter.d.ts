// The @types/react-syntax-highlighter package only declares the top-level
// package entry. We import from deep dist paths (prism-async-light, and
// individual themes) to keep the chunk small, so declare those paths here.

declare module 'react-syntax-highlighter/dist/esm/prism-async-light' {
  import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
  import type { FC } from 'react'
  const SyntaxHighlighter: FC<SyntaxHighlighterProps>
  export default SyntaxHighlighter
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/one-dark' {
  import type { CSSProperties } from 'react'
  const style: Record<string, CSSProperties>
  export default style
}
