import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  copied: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false }
  }

  handleCopy = () => {
    const { error } = this.state
    if (!error) return
    const text = `${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.setState({ copied: true })
        setTimeout(() => this.setState({ copied: false }), 2000)
      })
      .catch((err) => {
        console.warn('[ErrorBoundary] clipboard write failed:', err)
      })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="dark w-screen h-screen bg-background text-foreground flex items-center justify-center p-8">
          <div className="max-w-xl w-full">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
              <h1 className="text-lg font-semibold">Something went wrong</h1>
              <p className="text-sm text-muted-foreground mt-1">
                An unexpected error occurred.
                <br />
                You can try again or copy the details below to report the issue.
              </p>
            </div>

            <div className="relative bg-muted/30 border border-border/50 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                <span className="text-[11px] text-muted-foreground/60 font-mono">
                  Error Details
                </span>
                <button
                  onClick={this.handleCopy}
                  className="text-[11px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  {this.state.copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="text-xs font-mono text-muted-foreground p-3 overflow-y-auto overflow-x-hidden max-h-48 whitespace-pre-wrap break-all">
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            </div>

            <div className="flex justify-center mt-6">
              <button
                onClick={() => this.setState({ error: null, copied: false })}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
