import type { ReactNode } from 'react'

export default function WindowShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      {children}
    </div>
  )
}
