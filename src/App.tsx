import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { useWindowLifecycle } from '@/hooks/useWindowLifecycle'

function App() {
  const { isMain, isReady } = useWindowLifecycle()
  if (!isReady) return null
  return isMain ? <Canvas /> : <NewWindow />
}

export default App
