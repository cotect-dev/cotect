import { useEffect } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, setNodes, setEdges } =
    useCanvasStore()
  const currentPath = useBrowserStore((s) => s.currentPath)
  const viewMode = useBrowserStore((s) => s.viewMode)
  const entries = useBrowserStore((s) => s.entries)
  const fileAnalysis = useBrowserStore((s) => s.fileAnalysis)

  // Regenerate canvas nodes whenever browser state changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = useBrowserStore.getState().generateNodes()
    setNodes(newNodes)
    setEdges(newEdges)
  }, [currentPath, viewMode, entries, fileAnalysis, setNodes, setEdges])

  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
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
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <Breadcrumbs />
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </div>
  )
}
