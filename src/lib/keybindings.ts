export type KeyScope = 'global' | 'canvas' | 'panel' | 'settings'

export interface KeyBinding {
  id: string
  label: string
  scope: KeyScope
  group: 'Canvas' | 'Panels' | 'TopBar' | 'Settings' | 'Dev'
  chord: string                  // human-readable, e.g. "Cmd+P"
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

/** Helper: chord-match against a `KeyboardEvent`. */
export function matchChord(e: KeyboardEvent, chord: string): boolean {
  const parts = chord.toLowerCase().split('+')
  const wantMeta  = parts.includes('cmd') || parts.includes('meta')
  const wantCtrl  = parts.includes('ctrl')
  const wantAlt   = parts.includes('alt') || parts.includes('option')
  const wantShift = parts.includes('shift')
  const key = parts[parts.length - 1]
  return (
    e.metaKey  === wantMeta &&
    e.ctrlKey  === wantCtrl &&
    e.altKey   === wantAlt &&
    e.shiftKey === wantShift &&
    e.key.toLowerCase() === key
  )
}

/** Helper to declare a binding from a chord string. */
export function makeChordBinding(opts: {
  id: string; label: string; scope: KeyScope; group: KeyBinding['group']; chord: string
}): KeyBinding {
  return defineBinding({ ...opts, matches: (e) => matchChord(e, opts.chord) })
}
