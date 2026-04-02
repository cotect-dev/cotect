import { useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { X } from 'lucide-react'
import { useCanvasStore } from '@/store'
import { getPlatform } from '@/services/platform'

/**
 * Pick a CodeMirror language extension based on file extension.
 */
function getLanguageExt(filePath: string) {
  if (/\.(tsx?)$/.test(filePath)) return javascript({ typescript: true, jsx: true })
  if (/\.(jsx?)$/.test(filePath)) return javascript({ jsx: true })
  if (/\.json$/.test(filePath)) return json()
  if (/\.css$/.test(filePath)) return css()
  return javascript({ typescript: true }) // fallback
}

/**
 * CodePanel — slides in from the right when a function is selected.
 * Shows the function body with syntax highlighting and line numbers.
 * Supports editing and Ctrl+S to save the modified function back to the file.
 */
export default function CodePanel() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const selectedFunction = useCanvasStore((s) => s.selectedFunction)
  const clearSelectedFunction = useCanvasStore((s) => s.clearSelectedFunction)

  // Save handler: splice the edited content back into the full file
  const handleSave = useCallback(async () => {
    if (!selectedFunction || !viewRef.current) return

    const editedContent = viewRef.current.state.doc.toString()
    const lines = selectedFunction.fullFileContent.split('\n')

    // Replace the function's lines with the edited content
    const before = lines.slice(0, selectedFunction.startLine - 1)
    const after = lines.slice(selectedFunction.endLine)
    const newFileContent = [...before, editedContent, ...after].join('\n')

    try {
      await getPlatform().fs.writeFile(selectedFunction.filePath, newFileContent)
      // Update the store with new full file content
      useCanvasStore.setState({
        selectedFunction: {
          ...selectedFunction,
          content: editedContent,
          fullFileContent: newFileContent,
        },
      })
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }, [selectedFunction])

  // Initialize/update CodeMirror when the selected function changes
  useEffect(() => {
    if (!editorRef.current || !selectedFunction) return

    // Destroy existing editor
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const startLine = selectedFunction.startLine

    const state = EditorState.create({
      doc: selectedFunction.content,
      extensions: [
        lineNumbers({
          formatNumber: (n) => String(n + startLine - 1),
        }),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        getLanguageExt(selectedFunction.filePath),
        oneDark,
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              handleSave()
              return true
            },
          },
        ]),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          },
        }),
      ],
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [selectedFunction?.filePath, selectedFunction?.name, selectedFunction?.startLine]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedFunction) return null

  const fileName = selectedFunction.filePath.split('/').pop() || selectedFunction.filePath

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[35%] z-20 bg-background border-l border-border flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {selectedFunction.name}()
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {fileName}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
            L{selectedFunction.startLine}–{selectedFunction.endLine}
          </span>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
          onClick={clearSelectedFunction}
          aria-label="Close code panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="flex-1 overflow-auto" />

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border text-[10px] text-muted-foreground/60 shrink-0">
        <span>Ctrl+S to save</span>
        <span>{selectedFunction.endLine - selectedFunction.startLine + 1} lines</span>
      </div>
    </div>
  )
}
