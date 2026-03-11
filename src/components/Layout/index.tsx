import TopBar from './TopBar'
import RightPanel from './RightPanel'

export default function Layout() {
  return (
    <div className="w-full h-full flex flex-col gap-2 p-2 pointer-events-none">
      <TopBar />
      <div className="flex flex-1 min-h-0 justify-end gap-2">
        <RightPanel />
      </div>
    </div>
  )
}
