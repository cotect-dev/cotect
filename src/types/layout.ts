export type PanelPosition = 'left' | 'right' | 'bottom'

export interface PersistedLayout {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
  // Outer-zone ratios (left/right widths and bottom height as fractions of the
  // window). Optional for backwards compatibility with payloads written before
  // zoneSizes was unified into the layout store.
  zoneSizes?: { left: number; right: number; bottom: number }
}
