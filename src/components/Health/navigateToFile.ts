import { useViewStore } from '@/store/view'
import { useCanvasStore } from '@/store/canvas'
import { isDemoMode } from '@/lib/demoMode'

export function navigateToFile(repoRelativePath: string) {
  // The landing demo has no canvas to navigate to from the health view, and
  // focusFileByPath would rebuild columns it cannot rebuild without a
  // filesystem.
  if (isDemoMode()) return
  useViewStore.getState().setViewMode('files')
  void useCanvasStore.getState().focusFileByPath(repoRelativePath)
}
