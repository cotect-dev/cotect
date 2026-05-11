import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

// All panels are code-split: each one lives in its own chunk and only loads
// when its PanelHost portal mounts. Keeps CodeMirror out of the main chunk.
export const PANEL_CONTENT: Record<string, ComponentType | LazyExoticComponent<ComponentType>> = {
  console: lazy(() => import('@/components/Console')),
  changes: lazy(() => import('@/components/Changes')),
  history: lazy(() => import('@/components/History')),
  tasks: lazy(() => import('@/components/Tasks')),
}

export const PANEL_IDS = Object.keys(PANEL_CONTENT)
