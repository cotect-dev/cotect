import { Component, type ReactNode } from 'react'

export class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-border bg-card/40 p-8 text-center font-mono text-sm text-muted-foreground">
          demo failed to load. the desktop app still works.
        </div>
      )
    }
    return this.props.children
  }
}
