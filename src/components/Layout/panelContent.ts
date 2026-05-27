import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export const PANEL_CONTENT: Record<string, ComponentType | LazyExoticComponent<ComponentType>> = {
  console: lazy(() => import('@/components/Console')),
  changes: lazy(() => import('@/components/Changes')),
  history: lazy(() => import('@/components/History')),
}

export const PANEL_IDS = Object.keys(PANEL_CONTENT)
