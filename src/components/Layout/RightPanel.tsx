import { Card, CardBody } from '@heroui/react'
import { useLayoutStore } from '../../store'
import ResizeHandle from '../ResizeHandle'
import Chat from '../Chat'

export default function RightPanel() {
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth)

  return (
    <div
      style={{ width: rightPanelWidth }}
      className="relative shrink-0 h-full pointer-events-auto"
    >
      <ResizeHandle />
      <Card className="h-full">
        <CardBody className="p-3 overflow-hidden">
          <Chat />
        </CardBody>
      </Card>
    </div>
  )
}
