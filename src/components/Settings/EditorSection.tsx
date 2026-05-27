import Keybindings from './EditorSection/Keybindings'

export default function EditorSection() {
  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-semibold text-foreground mb-2">Editor</h2>

      <div className="flex flex-col gap-2 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
          Keybindings
        </div>
        <Keybindings />
      </div>
    </div>
  )
}
