// Demo mode mounts the real app views on the landing page against seeded
// stores. Guards the few code paths that touch Tauri or global input.
let demo = false

export function setDemoMode(on: boolean): void {
  demo = on
}

export function isDemoMode(): boolean {
  return demo
}
