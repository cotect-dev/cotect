import {
  ReactFlow,
  Background,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store'
import Layout from '../components/Layout'

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useCanvasStore()

  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </div>
  )
}
