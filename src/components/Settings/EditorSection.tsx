import { useKvField } from '@/hooks/useKvField'
import { usagePurge } from '@/services/db'
import { Button } from '@/components/ui/button'
import Keybindings from './EditorSection/Keybindings'

const THEMES = ['dark', 'light', 'system'] as const
type Theme = typeof THEMES[number]
const DENSITIES = ['compact', 'comfortable'] as const
type Density = typeof DENSITIES[number]

interface Appearance { theme: Theme; accent: string; density: Density }
interface Typography { ui_font: string; mono_font: string; base_size: number }
interface Canvas     { default_zoom: number; animate: boolean; auto_fit: boolean }
interface Preview    { max_size: number; syntax: boolean; wrap: boolean; whitespace: boolean; tab_width: number }
interface Panels     { sizes: Record<string, number>; panels: Record<string, string[][]>; locked: boolean }

const DEFAULT_APPEARANCE: Appearance = { theme: 'dark',     accent: '#9ec0ff', density: 'comfortable' }
const DEFAULT_TYPOGRAPHY: Typography = { ui_font: 'Geist', mono_font: 'Geist Mono', base_size: 13 }
const DEFAULT_CANVAS:     Canvas     = { default_zoom: 1, animate: true, auto_fit: true }
const DEFAULT_PREVIEW:    Preview    = { max_size: 512, syntax: true, wrap: false, whitespace: false, tab_width: 2 }
const DEFAULT_PANELS:     Panels     = { sizes: {}, panels: {}, locked: false }

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-4 items-center text-[11px]">
      <span className="text-foreground">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export default function EditorSection() {
  const [appearance, setAppearance] = useKvField<Appearance>('editor.appearance', DEFAULT_APPEARANCE)
  const [typography, setTypography] = useKvField<Typography>('editor.typography', DEFAULT_TYPOGRAPHY)
  const [canvas, setCanvas]         = useKvField<Canvas>('editor.canvas', DEFAULT_CANVAS)
  const [preview, setPreview]       = useKvField<Preview>('editor.preview', DEFAULT_PREVIEW)
  const [panels, setPanels]         = useKvField<Panels>('editor.panels', DEFAULT_PANELS)
  const [retention, setRetention]   = useKvField<number>('editor.usage_retention_days', 90)

  const onClearUsage = async () => {
    if (!confirm('Permanently delete all usage records? This cannot be undone.')) return
    await usagePurge(Date.now() + 1)    // > now means "all rows"
  }

  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-semibold text-foreground mb-2">Editor</h2>

      <Sub title="Appearance">
        <Row label="Theme">
          <select className="h-7 px-2 text-xs rounded border border-border bg-background"
            value={appearance.theme}
            onChange={(e) => setAppearance({ ...appearance, theme: e.target.value as Theme })}>
            {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Row>
        <Row label="Accent">
          <input type="color" className="h-6 w-10 rounded"
            value={appearance.accent}
            onChange={(e) => setAppearance({ ...appearance, accent: e.target.value })} />
        </Row>
        <Row label="Density">
          <select className="h-7 px-2 text-xs rounded border border-border bg-background"
            value={appearance.density}
            onChange={(e) => setAppearance({ ...appearance, density: e.target.value as Density })}>
            {DENSITIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Row>
      </Sub>

      <Sub title="Typography">
        <Row label="UI font">
          <input type="text" className="h-7 w-56 px-2 text-xs rounded border border-border bg-background font-mono"
            value={typography.ui_font}
            onChange={(e) => setTypography({ ...typography, ui_font: e.target.value })} />
        </Row>
        <Row label="Mono font">
          <input type="text" className="h-7 w-56 px-2 text-xs rounded border border-border bg-background font-mono"
            value={typography.mono_font}
            onChange={(e) => setTypography({ ...typography, mono_font: e.target.value })} />
        </Row>
        <Row label="Base size">
          <input type="range" min={12} max={18} step={1} className="w-48"
            value={typography.base_size}
            onChange={(e) => setTypography({ ...typography, base_size: Number(e.target.value) })} />
          <span className="ml-3 text-[11px] font-mono">{typography.base_size}px</span>
        </Row>
      </Sub>

      <Sub title="Canvas">
        <Row label="Default zoom">
          <input type="range" min={0.5} max={2} step={0.1} className="w-48"
            value={canvas.default_zoom}
            onChange={(e) => setCanvas({ ...canvas, default_zoom: Number(e.target.value) })} />
          <span className="ml-3 text-[11px] font-mono">{canvas.default_zoom.toFixed(1)}×</span>
        </Row>
        <Row label="Animate transitions">
          <input type="checkbox" checked={canvas.animate}
            onChange={(e) => setCanvas({ ...canvas, animate: e.target.checked })} />
        </Row>
        <Row label="Auto-fit on file open">
          <input type="checkbox" checked={canvas.auto_fit}
            onChange={(e) => setCanvas({ ...canvas, auto_fit: e.target.checked })} />
        </Row>
      </Sub>

      <Sub title="File preview">
        <Row label="Max preview size (KB)">
          <input type="number" min={1} max={10240}
            className="h-7 w-24 px-2 text-xs rounded border border-border bg-background"
            value={preview.max_size}
            onChange={(e) => setPreview({ ...preview, max_size: Number(e.target.value) })} />
        </Row>
        <Row label="Syntax highlighting">
          <input type="checkbox" checked={preview.syntax} onChange={(e) => setPreview({ ...preview, syntax: e.target.checked })} />
        </Row>
        <Row label="Word wrap">
          <input type="checkbox" checked={preview.wrap} onChange={(e) => setPreview({ ...preview, wrap: e.target.checked })} />
        </Row>
        <Row label="Show whitespace">
          <input type="checkbox" checked={preview.whitespace} onChange={(e) => setPreview({ ...preview, whitespace: e.target.checked })} />
        </Row>
        <Row label="Tab width">
          <input type="number" min={1} max={8}
            className="h-7 w-16 px-2 text-xs rounded border border-border bg-background"
            value={preview.tab_width}
            onChange={(e) => setPreview({ ...preview, tab_width: Number(e.target.value) })} />
        </Row>
      </Sub>

      <Sub title="Panel layout">
        <Row label="Lock layout">
          <input type="checkbox" checked={panels.locked}
            onChange={(e) => setPanels({ ...panels, locked: e.target.checked })} />
        </Row>
        <Row label="Reset to defaults">
          <Button size="sm" variant="secondary"
            onClick={() => setPanels(DEFAULT_PANELS)}
            className="h-6 px-2 text-[11px]">Reset</Button>
        </Row>
      </Sub>

      <Sub title="Keybindings">
        <Keybindings />
      </Sub>

      <Sub title="Storage">
        <Row label="Usage retention (days)">
          <input type="range" min={7} max={365} step={1} className="w-48"
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value))} />
          <span className="ml-3 text-[11px] font-mono">{retention} days</span>
        </Row>
        <Row label="Clear all usage data">
          <Button size="sm" variant="ghost" onClick={onClearUsage}
            className="h-6 px-2 text-[11px] text-red-400 hover:text-red-300">Clear</Button>
        </Row>
      </Sub>
    </div>
  )
}
