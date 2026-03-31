import { useEffect, useMemo } from 'react'
import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'

const proOptions = { hideAttribution: true }

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, setNodes, setEdges } =
    useCanvasStore()

  const currentPath = useBrowserStore((s) => s.currentPath)
  const viewMode = useBrowserStore((s) => s.viewMode)
  const entryCount = useBrowserStore((s) => s.entries.length)
  const declCount = useBrowserStore((s) => s.fileAnalysis?.declarations.length ?? -1)

  const generated = useMemo(
    () => useBrowserStore.getState().generateNodes(),
    [currentPath, viewMode, entryCount, declCount],
  )

  useEffect(() => {
    setNodes(generated.nodes)
    setEdges(generated.edges)
  }, [generated, setNodes, setEdges])

  return (
    <WindowShell>
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          proOptions={proOptions}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <Breadcrumbs />
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </WindowShell>
  )
}
