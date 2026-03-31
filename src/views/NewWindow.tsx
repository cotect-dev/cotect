import Layout from '@/components/Layout'
import WindowShell from '@/components/WindowShell'

export default function NewWindow() {
  return (
    <WindowShell>
      <div className="absolute inset-0 z-10">
        <Layout mode="panel" />
      </div>
    </WindowShell>
  )
}
