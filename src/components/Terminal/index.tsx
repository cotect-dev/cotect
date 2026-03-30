import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { os } from '@neutralinojs/lib'
import { useTerminalStore, runCommand, killActiveProcess } from '@/store/terminal'
import { loadPanelState, savePanelState } from '@/services/panelState'

// Persistent xterm instance — survives component remounts
let persistentTerm: XTerm | null = null
let persistentFitAddon: FitAddon | null = null
let persistentContainer: HTMLDivElement | null = null
let initialized = false

function getOrCreateTerm() {
  if (persistentTerm) return { term: persistentTerm, fitAddon: persistentFitAddon!, container: persistentContainer! }

  const term = new XTerm({
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    cursorBlink: true,
    theme: {
      background: '#00000000',
      foreground: '#e4e4e7',
      cursor: '#e4e4e7',
      black: '#18181b',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e4e4e7',
      brightBlack: '#71717a',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
    allowTransparency: true,
    scrollback: 5000,
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  const container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'
  term.open(container)

  persistentTerm = term
  persistentFitAddon = fitAddon
  persistentContainer = container

  return { term, fitAddon, container }
}

export default function Terminal() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef('')
  const cursorPosRef = useRef(0)

  // Sync panel state across windows
  useEffect(() => {
    loadPanelState<{ cwd: string; history: string[] }>('terminal').then((saved) => {
      if (saved) {
        if (saved.cwd) useTerminalStore.getState().setCwd(saved.cwd)
        if (saved.history) {
          const store = useTerminalStore.getState()
          for (const cmd of saved.history) {
            if (!store.history.includes(cmd)) store.pushHistory(cmd)
          }
        }
      }
    })

    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useTerminalStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const { cwd, history } = useTerminalStore.getState()
        savePanelState('terminal', { cwd, history })
      }, 300)
    })

    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      const { cwd, history } = useTerminalStore.getState()
      savePanelState('terminal', { cwd, history })
    }
  }, [])

  const cwd = useTerminalStore((s) => s.cwd)
  const running = useTerminalStore((s) => s.running)
  const history = useTerminalStore((s) => s.history)
  const historyIndex = useTerminalStore((s) => s.historyIndex)
  const setHistoryIndex = useTerminalStore((s) => s.setHistoryIndex)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const runningRef = useRef(running)
  runningRef.current = running
  const historyRef = useRef(history)
  historyRef.current = history
  const historyIndexRef = useRef(historyIndex)
  historyIndexRef.current = historyIndex

  const writePrompt = useCallback(() => {
    persistentTerm?.write(`\x1b[34m${cwdRef.current}\x1b[0m $ `)
  }, [])

  const prevRunningRef = useRef(running)
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      writePrompt()
    }
    prevRunningRef.current = running
  }, [running, writePrompt])

  useEffect(() => {
    if (!wrapperRef.current) return

    const { term, fitAddon, container } = getOrCreateTerm()

    // Attach persistent container to current wrapper
    wrapperRef.current.appendChild(container)
    fitAddon.fit()

    // Only set up input handling and prompt once
    if (!initialized) {
      initialized = true
      useTerminalStore.getState().setXterm(term)
      writePrompt()

      const redrawInput = () => {
        const prompt = `\x1b[34m${cwdRef.current}\x1b[0m $ `
        term.write(`\x1b[2K\r${prompt}${inputRef.current}`)
        const diff = inputRef.current.length - cursorPosRef.current
        if (diff > 0) {
          term.write(`\x1b[${diff}D`)
        }
      }

      let tabBusy = false

      const handleTab = async () => {
        if (!window.NL_PORT || tabBusy) return
        tabBusy = true

        try {
          const input = inputRef.current
          const beforeCursor = input.slice(0, cursorPosRef.current)
          const parts = beforeCursor.split(/\s+/)
          const partial = parts[parts.length - 1] ?? ''
          const isFirstWord = parts.length <= 1

          // Use compgen: -c for commands (first word), -f for files (arguments)
          const flag = isFirstWord ? '-c' : '-f'
          const result = await os.execCommand(
            `bash -c ${JSON.stringify(`compgen ${flag} -- ${partial.replace(/'/g, "'\\''")}`)}`,
            { cwd: cwdRef.current },
          )

          if (result.exitCode !== 0 || !result.stdOut.trim()) {
            tabBusy = false
            return
          }

          const matches = result.stdOut.trim().split('\n')

          if (matches.length === 1) {
            // Single match — complete it
            const completion = matches[0]
            let suffix = completion.slice(partial.length)

            // Add trailing slash for directories, space for commands
            if (!isFirstWord) {
              try {
                const stat = await os.execCommand(
                  `test -d ${JSON.stringify(completion)} && echo d || echo f`,
                  { cwd: cwdRef.current },
                )
                suffix += stat.stdOut.trim() === 'd' ? '/' : ' '
              } catch {
                suffix += ' '
              }
            } else {
              suffix += ' '
            }

            const before = input.slice(0, cursorPosRef.current)
            const after = input.slice(cursorPosRef.current)
            inputRef.current = before + suffix + after
            cursorPosRef.current += suffix.length
            redrawInput()
          } else {
            // Multiple matches — find common prefix and show options
            let common = matches[0]
            for (let i = 1; i < matches.length; i++) {
              while (!matches[i].startsWith(common)) {
                common = common.slice(0, -1)
              }
            }

            const extraChars = common.slice(partial.length)
            if (extraChars) {
              const before = input.slice(0, cursorPosRef.current)
              const after = input.slice(cursorPosRef.current)
              inputRef.current = before + extraChars + after
              cursorPosRef.current += extraChars.length
              redrawInput()
            } else {
              // Show all matches
              const display = matches.map((m) => m.split('/').pop() ?? m).join('  ')
              term.write(`\r\n\x1b[90m${display}\x1b[0m\r\n`)
              const prompt = `\x1b[34m${cwdRef.current}\x1b[0m $ `
              term.write(`${prompt}${inputRef.current}`)
              const diff = inputRef.current.length - cursorPosRef.current
              if (diff > 0) term.write(`\x1b[${diff}D`)
            }
          }
        } catch {
          // Completion failed silently
        } finally {
          tabBusy = false
        }
      }

      term.onData((data) => {
        if (runningRef.current) {
          if (data === '\x03') killActiveProcess()
          return
        }

        if (data === '\t') {
          handleTab()
        } else if (data === '\r') {
          const cmd = inputRef.current
          term.write('\r\n')
          inputRef.current = ''
          cursorPosRef.current = 0
          runCommand(cmd)
        } else if (data === '\x7f') {
          if (cursorPosRef.current > 0) {
            const before = inputRef.current.slice(0, cursorPosRef.current - 1)
            const after = inputRef.current.slice(cursorPosRef.current)
            inputRef.current = before + after
            cursorPosRef.current--
            redrawInput()
          }
        } else if (data === '\x03') {
          if (inputRef.current) {
            term.write('^C\r\n')
            inputRef.current = ''
            cursorPosRef.current = 0
            writePrompt()
          }
        } else if (data === '\x1b[A') {
          const hist = historyRef.current
          if (hist.length === 0) return
          const idx = historyIndexRef.current === -1
            ? hist.length - 1
            : Math.max(0, historyIndexRef.current - 1)
          setHistoryIndex(idx)
          historyIndexRef.current = idx
          inputRef.current = hist[idx]
          cursorPosRef.current = hist[idx].length
          redrawInput()
        } else if (data === '\x1b[B') {
          if (historyIndexRef.current === -1) return
          const hist = historyRef.current
          const next = historyIndexRef.current + 1
          if (next >= hist.length) {
            setHistoryIndex(-1)
            historyIndexRef.current = -1
            inputRef.current = ''
            cursorPosRef.current = 0
          } else {
            setHistoryIndex(next)
            historyIndexRef.current = next
            inputRef.current = hist[next]
            cursorPosRef.current = hist[next].length
          }
          redrawInput()
        } else if (data === '\x1b[C') {
          if (cursorPosRef.current < inputRef.current.length) {
            cursorPosRef.current++
            term.write(data)
          }
        } else if (data === '\x1b[D') {
          if (cursorPosRef.current > 0) {
            cursorPosRef.current--
            term.write(data)
          }
        } else if (data >= ' ') {
          const atEnd = cursorPosRef.current === inputRef.current.length
          const before = inputRef.current.slice(0, cursorPosRef.current)
          const after = inputRef.current.slice(cursorPosRef.current)
          inputRef.current = before + data + after
          cursorPosRef.current += data.length
          if (atEnd) {
            term.write(data)
          } else {
            redrawInput()
          }
        }
      })
    }

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(wrapperRef.current)

    return () => {
      observer.disconnect()
      // Detach but don't destroy — preserves terminal state
      if (container.parentElement) {
        container.parentElement.removeChild(container)
      }
    }
  }, [writePrompt, setHistoryIndex])

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full"
    />
  )
}
