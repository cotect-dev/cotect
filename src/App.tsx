import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { useWindowLifecycle } from '@/hooks/useWindowLifecycle'
import { useConsoleHotkey } from '@/hooks/useConsoleHotkey'

function App() {
  const { isMain, isReady } = useWindowLifecycle()
  useConsoleHotkey()
  if (!isReady) return null
  return isMain ? <Canvas /> : <NewWindow />
}

export default App
