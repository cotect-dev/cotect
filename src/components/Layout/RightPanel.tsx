import Chat from '../Chat'

export default function RightPanel() {
  return (
    <div className="h-full pointer-events-auto overflow-hidden p-3 bg-background/80 backdrop-blur-sm">
      <Chat />
    </div>
  )
}
