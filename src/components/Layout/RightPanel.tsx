import { Card, CardBody, Input } from '@heroui/react'
import { useLayoutStore } from '../../store'
import ResizeHandle from '../ResizeHandle'

export default function RightPanel() {
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth)

  return (
    <div
      style={{ width: rightPanelWidth }}
      className="relative shrink-0 h-full pointer-events-auto"
    >
      <ResizeHandle />
      <Card className="h-full">
        <CardBody>
          <Input label="Test" placeholder="Type something..." />
        </CardBody>
      </Card>
    </div>
  )
}
