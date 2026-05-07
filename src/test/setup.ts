import '@testing-library/jest-dom/vitest'

// Mock Tauri APIs that are imported at the module level in various files.
// Tests that need specific behavior can override these per-test via vi.mocked().
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: vi.fn(),
  getCurrentWebviewWindow: vi.fn(() => ({
    label: 'main',
    outerPosition: vi.fn(),
    outerSize: vi.fn(),
    setPosition: vi.fn(),
    setSize: vi.fn(),
    setMinSize: vi.fn(),
    maximize: vi.fn(),
    isMaximized: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    onMoved: vi.fn(),
    onResized: vi.fn(),
  })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(),
  stat: vi.fn().mockResolvedValue({ mtime: null }),
}))
