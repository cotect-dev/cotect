import { useEffect } from 'react'
import { window as neuWindow } from '@neutralinojs/lib'
import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'

const params = new URLSearchParams(window.location.search)
const windowType = params.get('window')

function App() {
  useEffect(() => {
    if (window.NL_PORT) {
      neuWindow.setSize({ minWidth: 1280, minHeight: 720 }).catch(() => {})
    }
  }, [])

  if (windowType === 'new') return <NewWindow />
  return <Canvas />
}

export default App
