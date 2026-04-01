import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarCheckboxItem,
} from '@/components/ui/menubar'
import { useLayoutStore, loadLayoutIntoStore, PANEL_DEFINITIONS } from '@/store/layout'
import { useBrowserStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { saveLayout } from '@/services/windowManager'
import { DEFAULT_MAIN_LAYOUT } from '@/lib/constants'

interface TopBarProps {
  onResetZoneSizes?: () => void
}

export default function TopBar({ onResetZoneSizes }: TopBarProps) {
  const platform = getPlatform()
  const panels = useLayoutStore((s) => s.panels)
  const addPanel = useLayoutStore((s) => s.addPanel)
  const removePanel = useLayoutStore((s) => s.removePanel)
  const handleOpenFolder = async () => {
    try {
      const result = await platform.fs.showFolderDialog('Open Project Folder')
      if (result) {
        useBrowserStore.getState().openRoot(result)
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err)
    }
  }

  const isPanelVisible = (id: string) => {
    return panels.left.some(g => g.includes(id)) || panels.right.some(g => g.includes(id)) || panels.bottom.some(g => g.includes(id))
  }

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
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Zoom In</MenubarItem>
          <MenubarItem>Zoom Out</MenubarItem>
          <MenubarSeparator />
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
          {PANEL_DEFINITIONS.map((def) => {
            const visible = isPanelVisible(def.id)
            return (
              <MenubarCheckboxItem
                key={def.id}
                checked={visible}
                onCheckedChange={() => {
                  if (visible) {
                    removePanel(def.id)
                  } else {
                    addPanel(def.id, def.defaultPosition)
                  }
                }}
              >
                {def.label}
              </MenubarCheckboxItem>
            )
          })}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}
