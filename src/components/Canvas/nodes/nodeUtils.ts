import type { NodeDisplayFlags } from '@/types/nodes'

export interface ResolvedNodeFlags {
  isFocused: boolean
  isCurrent: boolean
  isHidden: boolean
}

/** Extract display flags injected by flattenAndRender. */
export function getNodeFlags(data: NodeDisplayFlags): ResolvedNodeFlags {
  return {
    isFocused: data.__isFocused ?? false,
    isCurrent: data.__isCurrent ?? true,
    isHidden: data.__isHidden ?? false,
  }
}

/** `isHidden` (30%) wins over `!isCurrent || isPreview` (50%). */
export function getNodeOpacity(
  flags: Pick<ResolvedNodeFlags, 'isCurrent' | 'isHidden'> & { isPreview?: boolean },
): string {
  if (flags.isHidden) return 'opacity-30'
  if (!flags.isCurrent || flags.isPreview) return 'opacity-50'
  return ''
}

const FOCUS_OUTLINE = 'outline outline-2 outline-primary/60'

/**
 * `'tinted'` adds a primary bg (BaseNode, ImageNode); `'bordered'` tints the
 * border — used for CodeNode, where a bg tint would bleed into the editor.
 */
export function nodeFocusRing(focused: boolean, variant: 'tinted' | 'bordered'): string {
  if (!focused) return ''
  return `${FOCUS_OUTLINE} ${variant === 'tinted' ? 'bg-primary/10' : 'border-primary/40'}`
}
