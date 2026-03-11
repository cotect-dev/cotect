import { Card, CardHeader } from '@heroui/react'

export default function TopBar() {
  return (
    <Card className="shrink-0 pointer-events-auto">
      <CardHeader className="px-4 py-3">
        <span className="font-semibold text-sm tracking-wide">
          Cotect
        </span>
      </CardHeader>
    </Card>
  )
}
