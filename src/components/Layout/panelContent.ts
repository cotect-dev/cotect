import type { ComponentType } from 'react'
import Chat from '@/components/Chat'
import Console from '@/components/Console'
import Changes from '@/components/Changes'
import History from '@/components/History'
import Branches from '@/components/Branches'
import Tasks from '@/components/Tasks'
import Settings from '@/components/Settings'

export const PANEL_CONTENT: Record<string, ComponentType> = {
  chat: Chat,
  console: Console,
  changes: Changes,
  history: History,
  branches: Branches,
  tasks: Tasks,
  settings: Settings,
}

export const PANEL_IDS = Object.keys(PANEL_CONTENT)
