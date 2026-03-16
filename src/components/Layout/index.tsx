import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import TopBar from './TopBar'
import RightPanel from './RightPanel'

export default function Layout() {
  return (
    <div className="w-screen h-screen flex flex-col pointer-events-none">
      <TopBar />
      <div className="flex-1 min-h-0 w-full">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel defaultSize={60} minSize={50} className="pointer-events-none" />
          <ResizableHandle withHandle className="pointer-events-auto hover:bg-stormy-teal/40 active:bg-stormy-teal/60 transition-colors" />
          <ResizablePanel defaultSize={40} minSize={25} maxSize={50}>
            <RightPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
