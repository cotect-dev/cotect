import { useViewStore } from '@/store/view'
import { useCanvasStore } from '@/store/canvas'

export function navigateToFile(repoRelativePath: string) {
  useViewStore.getState().setViewMode('files')
  void useCanvasStore.getState().focusFileByPath(repoRelativePath)
}
