import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarCheckboxItem,
} from '@/components/ui/menubar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { useLayoutStore, loadLayoutIntoStore, PANEL_DEFINITIONS, getEffectivePosition } from '@/store/layout'
import { useBrowserStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { saveLayout } from '@/services/windowManager'
import { DEFAULT_MAIN_LAYOUT } from '@/lib/constants'
import { useGitStore, branchLabel } from '@/store/git'
import { useViewStore, type ViewMode } from '@/store/view'
import RelativeTime from '@/components/RelativeTime'
import { DEV } from '@/lib/env'
import { useState, useCallback, Fragment } from 'react'
import { GitBranch, ChevronDown, FolderTree, Network, Settings as SettingsIcon, BarChart3 } from 'lucide-react'

const VIEW_BUTTONS: { mode: ViewMode; key: string; label: string; Icon: typeof FolderTree }[] = [
  { mode: 'files',     key: '1', label: 'Files',     Icon: FolderTree },
  { mode: 'graph',     key: '2', label: 'Graph',     Icon: Network },
  { mode: 'settings',  key: '3', label: 'Settings',  Icon: SettingsIcon },
  { mode: 'analytics', key: '4', label: 'Analytics', Icon: BarChart3 },
]

interface TopBarProps {
  onResetZoneSizes?: () => void
}

const PANEL_GROUPS = [
  { group: 'git', label: 'Git' },
  { group: 'agent', label: 'Agent' },
] as const

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
  const viewMode = useViewStore((s) => s.viewMode)
  const setViewMode = useViewStore((s) => s.setViewMode)
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const totalInsertions = useGitStore((s) => s.status?.total_insertions ?? 0)
  const totalDeletions = useGitStore((s) => s.status?.total_deletions ?? 0)
  const lastCommitTimestamp = useGitStore((s) => s.lastCommitTimestamp)
  const branch = useGitStore((s) => s.branch)
  const branches = useGitStore((s) => s.branches)
  const checkoutBranch = useGitStore((s) => s.checkoutBranch)
  const currentBranchName = branch?.kind === 'branch' ? branch.name : null
  const handleBranchSelect = useCallback(
    (name: string) => {
      if (name === currentBranchName) return
      checkoutBranch(name).catch((err) => {
        console.error('Failed to switch branch:', err)
      })
    },
    [checkoutBranch, currentBranchName],
  )

  const isPanelVisible = useCallback((id: string) => {
    return panels.left.some(g => g.includes(id)) || panels.right.some(g => g.includes(id)) || panels.bottom.some(g => g.includes(id))
  }, [panels])

  return (
    <Menubar className="shrink-0 pointer-events-auto bg-background/80 backdrop-blur-sm">
      <img src="/icon.svg" alt="Cotect" className="h-6 w-6 ml-1 mr-1" />
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled>New</MenubarItem>
          <MenubarItem onClick={handleOpenFolder}>Open Folder...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled>Save</MenubarItem>
          <MenubarItem disabled>Save As...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => platform.windows.close()}>Exit</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled>Undo</MenubarItem>
          <MenubarItem disabled>Redo</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled>Cut</MenubarItem>
          <MenubarItem disabled>Copy</MenubarItem>
          <MenubarItem disabled>Paste</MenubarItem>
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
          {PANEL_GROUPS.map(({ group, label }, i) => (
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
      {isMainWindow && (
        <div className="flex items-center gap-0.5 pr-2">
          {VIEW_BUTTONS.map(({ mode, key, label, Icon }) => {
            const active = viewMode === mode
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={`${label} (${key})`}
                className={
                  active
                    ? 'rounded p-1 bg-accent text-accent-foreground'
                    : 'rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      )}
      {isMainWindow && isGitRepo && (
        <div className="flex items-center gap-2 pr-2 text-xs font-mono select-none">
          {branch && (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={branches.length === 0}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="max-w-[160px] truncate">{branchLabel(branch)}</span>
                {branches.length > 0 && <ChevronDown className="h-3 w-3 opacity-60" />}
              </DropdownMenuTrigger>
              {branches.length > 0 && (
                <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto font-mono text-xs">
                  <DropdownMenuRadioGroup
                    value={currentBranchName ?? ''}
                    onValueChange={handleBranchSelect}
                  >
                    {branches.map((name) => (
                      <DropdownMenuRadioItem key={name} value={name}>
                        {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          )}
          {(totalInsertions > 0 || totalDeletions > 0 || lastCommitTimestamp) && (
            <div className="flex items-center gap-1.5">
              {totalInsertions > 0 && <span className="text-green-500">+{totalInsertions}</span>}
              {totalDeletions > 0 && <span className="text-red-500">-{totalDeletions}</span>}
              {lastCommitTimestamp && (
                <>
                  {(totalInsertions > 0 || totalDeletions > 0) && <span className="text-muted-foreground/40">·</span>}
                  <RelativeTime timestamp={lastCommitTimestamp} className="text-muted-foreground/60" />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Menubar>
  )
}
