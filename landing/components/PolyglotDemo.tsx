import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { buildEditorExtensions } from '@/components/Canvas/nodes/codeNode/editorExtensions'
import { CodeNodeHeader } from '@/components/Canvas/nodes/codeNode/CodeNodeHeader'
import { POLYGLOT_TABS } from '../demoCode'

/** Language-switcher demo: every tab tears down and remounts the app's real
 *  editor (syntax, indentation guides, rainbow brackets) and reports how long
 *  the mount took — the same cold-open path the desktop app optimizes. */
export function PolyglotDemo() {
  const [tab, setTab] = useState(0)
  const [mountMs, setMountMs] = useState<number | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  const { file, code } = POLYGLOT_TABS[tab]

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const current = POLYGLOT_TABS[tab]
    const t0 = performance.now()
    const view = new EditorView({
      state: EditorState.create({
        doc: current.code,
        extensions: buildEditorExtensions({
          filePath: current.file,
          startLine: 1,
          mergeExt: new Compartment().of([]),
          wrapExt: new Compartment().of([]),
          readOnlyExt: new Compartment().of(EditorState.readOnly.of(true)),
          onSave: () => {},
          onDocChanged: () => {},
          onFocusChange: () => {},
          onGeometryChange: () => {},
          getInlineImports: () => null,
          onOpenImport: () => {},
        }),
      }),
      parent: host,
    })
    // Measure to the next frame so layout + first paint are included.
    const raf = requestAnimationFrame(() => setMountMs(performance.now() - t0))
    return () => {
      cancelAnimationFrame(raf)
      view.destroy()
    }
  }, [tab])

  const fileName = file.split('/').pop() ?? file
  const dirPrefix = file.slice(0, file.length - fileName.length)

  return (
    <div className="demo-card rounded-lg border border-border bg-[#1e1e1e] shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-1.5">
          {POLYGLOT_TABS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setTab(i)}
              className={`text-[11px] font-mono px-2 py-1 rounded cursor-pointer transition-colors ${
                i === tab
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {mountMs !== null && (
          <span
            className="font-mono text-[11px] text-muted-foreground"
            title="EditorView construction to next frame"
          >
            editor mounted in <span className="text-green-400">{mountMs.toFixed(1)} ms</span>
          </span>
        )}
      </div>
      <CodeNodeHeader
        displayPath={file}
        dirPrefix={dirPrefix}
        fileName={fileName}
        isMd={false}
        mdPreview={false}
        onToggleMdPreview={() => {}}
        isNewFile={false}
        isReadOnly
        dirty={false}
        saving={false}
        editorFocused={false}
        lineCount={code.split('\n').length - 1}
        lineWrap={false}
        onToggleLineWrap={() => {}}
        canUnlock={false}
        unlocked={false}
        onToggleUnlocked={() => {}}
      />
      <div ref={hostRef} className="demo-editor-host" style={{ height: 320 }} />
    </div>
  )
}
