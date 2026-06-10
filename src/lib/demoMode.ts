// Mutable module flag (not an env define): the landing build shares src/ chunks
// with the app, so the landing entry flips this at boot before React mounts.
let demo = false

export function setDemoMode(on: boolean): void {
  demo = on
}

export function isDemoMode(): boolean {
  return demo
}
