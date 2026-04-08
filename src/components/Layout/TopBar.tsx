import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarCheckboxItem,
} from '@/components/ui/menubar'
import { useLayoutStore, loadLayoutIntoStore, PANEL_DEFINITIONS, getEffectivePosition } from '@/store/layout'
import { useBrowserStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { saveLayout } from '@/services/windowManager'
import { DEFAULT_MAIN_LAYOUT } from '@/lib/constants'
import { useGitStore } from '@/store/git'
import RelativeTime from '@/components/RelativeTime'
import { DEV } from '@/lib/env'
import { useState, useCallback, useMemo, Fragment } from 'react'
import { GitBranch } from 'lucide-react'

interface TopBarProps {
  onResetZoneSizes?: () => void
}

export default function TopBar({ onResetZoneSizes }: TopBarProps) {
  const [testError, setTestError] = useState(false)
  if (testError) throw new Error('Test error — this is intentional')
  const platform = getPlatform()
  const panels = useLayoutStore((s) => s.panels)
  const addPanel = useLayoutStore((s) => s.addPanel)
  const removePanel = useLayoutStore((s) => s.removePanel)
  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await platform.fs.showFolderDialog('Open Project Folder')
      if (result) {
        useBrowserStore.getState().openRoot(result)
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err)
    }
  }, [platform])

  const isMainWindow = platform.windows.getWindowId() === 'main'
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const totalInsertions = useGitStore((s) => s.status?.total_insertions ?? 0)
  const totalDeletions = useGitStore((s) => s.status?.total_deletions ?? 0)
  const lastCommitTimestamp = useGitStore((s) => s.lastCommitTimestamp)

  const isPanelVisible = useCallback((id: string) => {
    return panels.left.some(g => g.includes(id)) || panels.right.some(g => g.includes(id)) || panels.bottom.some(g => g.includes(id))
  }, [panels])

  const panelGroups = useMemo(() => [
    { group: 'git' as const, label: 'Git' },
    { group: 'tools' as const, label: 'Tools' },
    { group: 'agent' as const, label: 'Agent' },
  ], [])

  return (
    <Menubar className="shrink-0 pointer-events-auto bg-background/80 backdrop-blur-sm">
      <img src="/cotect.svg" alt="Cotect" className="h-6 w-6 ml-1 mr-1" />
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>New</MenubarItem>
          <MenubarItem onClick={handleOpenFolder}>Open Folder...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Save</MenubarItem>
          <MenubarItem>Save As...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => platform.windows.close()}>Exit</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Undo</MenubarItem>
          <MenubarItem>Redo</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Cut</MenubarItem>
          <MenubarItem>Copy</MenubarItem>
          <MenubarItem>Paste</MenubarItem>
          {DEV && (
            <>
              <MenubarSeparator />
              <MenubarItem onClick={() => setTestError(true)}>
                Trigger Test Error
              </MenubarItem>
            </>
          )}
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem
            onClick={() => {
              loadLayoutIntoStore(DEFAULT_MAIN_LAYOUT)
              onResetZoneSizes?.()
            }}
          >
            Reset View
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            onClick={() => {
              const id = crypto.randomUUID()
              saveLayout(id, {
                panels: { left: [], right: [], bottom: [] },
                sizes: { left: [], right: [], bottom: [] },
                activeTab: {},
              })
              void platform.ipc.emit('window-opened', { windowId: id })
              void platform.windows.create(id)
            }}
          >
            New Window
          </MenubarItem>
          <MenubarSeparator />
          {panelGroups.map(({ group, label }, i) => (
            <Fragment key={group}>
              {i > 0 && <MenubarSeparator />}
              <div className="px-2 py-1 text-[11px] text-muted-foreground/50 font-medium select-none">{label}</div>
              {PANEL_DEFINITIONS.filter((d) => d.group === group).map((def) => {
                const visible = isPanelVisible(def.id)
                return (
                  <MenubarCheckboxItem
                    key={def.id}
                    checked={visible}
                    onCheckedChange={() => {
                      if (visible) {
                        removePanel(def.id)
                      } else {
                        const isChild = getPlatform().windows.getWindowId() !== 'main'
                        addPanel(def.id, getEffectivePosition(def.id, isChild))
                      }
                    }}
                  >
                    {def.label}
                  </MenubarCheckboxItem>
                )
              })}
            </Fragment>
          ))}
        </MenubarContent>
      </MenubarMenu>
      <div className="flex-1" />
      {isMainWindow && isGitRepo && (totalInsertions > 0 || totalDeletions > 0 || lastCommitTimestamp) && (
        <div className="flex items-center gap-1.5 pr-2 text-xs font-mono select-none">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground/60" />
          {totalInsertions > 0 && <span className="text-green-500">+{totalInsertions}</span>}
          {totalDeletions > 0 && <span className="text-red-500">-{totalDeletions}</span>}
          {lastCommitTimestamp && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <RelativeTime timestamp={lastCommitTimestamp} className="text-muted-foreground/60" />
            </>
          )}
        </div>
      )}
    </Menubar>
  )
}
