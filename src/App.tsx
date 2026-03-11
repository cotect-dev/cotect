import { useEffect } from 'react'
import Canvas from './views/Canvas'

function App() {
  useEffect(() => {
    if (window.Neutralino) {
      window.Neutralino.init()
      window.Neutralino.window.setSize({ minWidth: 1280, minHeight: 720 })
    }
  }, [])

  return <Canvas />
}

export default App
