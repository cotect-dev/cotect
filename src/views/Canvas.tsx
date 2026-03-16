import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '../store'
import Layout from '../components/Layout'

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useCanvasStore()

  return (
    <div className="dark w-screen h-screen text-foreground bg-background">
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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#003356" />
        <Panel
          position="top-left"
          className="!inset-0 !m-0 pointer-events-none"
        >
          <Layout />
        </Panel>
      </ReactFlow>
    </div>
  )
}
