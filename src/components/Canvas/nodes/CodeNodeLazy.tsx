import { lazy, Suspense } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { CodeNode as CodeNodeType } from '@/types/nodes'

// Lazy-load the CodeNode so CodeMirror (and its lang extensions) only download
// when the user first navigates into a file — keeps the main bundle lean.
const LazyCodeNode = lazy(() => import('./CodeNode'))

export default function CodeNodeLazy(props: NodeProps<CodeNodeType>) {
  return (
    <Suspense fallback={null}>
      <LazyCodeNode {...props} />
    </Suspense>
  )
}
