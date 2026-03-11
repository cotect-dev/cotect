import { useState, useEffect } from 'react'

function App() {
  const [count, setCount] = useState(0)
  const [neuVersion, setNeuVersion] = useState<string | null>(null)

  useEffect(() => {
    if (window.Neutralino) {
      window.Neutralino.init()
      window.Neutralino.app.getConfig().then((config: { version: string }) => {
        setNeuVersion(config.version)
      }).catch(() => {
        setNeuVersion('unknown')
      })
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center space-y-8">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Cotect
        </h1>
        <p className="text-gray-400 text-lg">
          React + Vite + Tailwind + NeutralinoJS
        </p>

        <div className="bg-gray-800 rounded-xl p-8 shadow-lg space-y-4">
          <button
            onClick={() => setCount((c) => c + 1)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors cursor-pointer"
          >
            Count is {count}
          </button>
          <p className="text-gray-500 text-sm">
            Edit <code className="text-blue-400">src/App.tsx</code> and save to test HMR
          </p>
        </div>

        {neuVersion && (
          <p className="text-gray-600 text-xs">
            Neutralino config version: {neuVersion}
          </p>
        )}
      </div>
    </div>
  )
}

export default App
