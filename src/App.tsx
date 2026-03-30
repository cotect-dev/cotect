import { useEffect } from 'react'
import { window as neuWindow } from '@neutralinojs/lib'
import Canvas from '@/views/Canvas'

function App() {
  useEffect(() => {
    if (window.NL_PORT) {
      neuWindow.setSize({ minWidth: 1280, minHeight: 720 }).catch(() => {})
    }
  }, [])

  return <Canvas />
}

export default App
