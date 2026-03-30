import Layout from '@/components/Layout'

export default function NewWindow() {
  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </div>
  )
}
