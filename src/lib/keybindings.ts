export type KeyScope = 'global' | 'canvas' | 'panel' | 'settings'

export interface KeyBinding {
  id: string
  label: string
  scope: KeyScope
  group: 'Canvas' | 'Panels' | 'TopBar' | 'Settings' | 'Dev'
  chord: string // human-readable, e.g. "Cmd+P"
  matches: (e: KeyboardEvent) => boolean
}

export const KEYBINDINGS: KeyBinding[] = []

/** Register a binding once at module load. Returns the same binding for chaining.
 *  Idempotent: re-registering the same id (e.g. during Vite HMR) replaces the
 *  previous entry instead of throwing. */
export function defineBinding(b: KeyBinding): KeyBinding {
  const idx = KEYBINDINGS.findIndex((x) => x.id === b.id)
  if (idx !== -1) {
    KEYBINDINGS[idx] = b
  } else {
    KEYBINDINGS.push(b)
  }
  return b
}
