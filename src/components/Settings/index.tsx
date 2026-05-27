import EditorSection from './EditorSection'

export default function Settings() {
  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">
          <EditorSection />
        </div>
      </div>
    </div>
  )
}
