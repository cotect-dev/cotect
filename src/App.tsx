import { useEffect } from 'react'
import Canvas from './views/Canvas'

function App() {
  useEffect(() => {
    if (window.Neutralino) {
      window.Neutralino.init()
    }
  }, [])

  return <Canvas />
}

export default App
