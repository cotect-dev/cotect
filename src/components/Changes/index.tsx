import { memo, useMemo } from 'react'
import { useGitStore, type GitFileStatus } from '@/store/git'
import NoGitRepo from '@/components/NoGitRepo'

interface TreeNode {
  name: string
  path: string
  file?: GitFileStatus
  children: TreeNode[]
}

function buildCompactTree(files: GitFileStatus[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = current.children.find((c) => c.name === parts[i] && !c.file)
      if (!child) {
        child = { name: parts[i], path: parts.slice(0, i + 1).join('/'), children: [] }
        current.children.push(child)
      }
      current = child
    }
    current.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      file,
      children: [],
    })
  }

  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse)
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0]
      return { ...child, name: `${node.name}/${child.name}` }
    }
    return node
  }

  return collapse(root).children
}

const statusColors: Record<string, string> = {
  M: 'text-yellow-500',
  A: 'text-green-500',
  D: 'text-red-500',
  R: 'text-blue-500',
  '??': 'text-muted-foreground',
}

const FileEntry = memo(function FileEntry({ file }: { file: GitFileStatus }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-px hover:bg-muted/30 text-xs font-mono">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}>
          {file.status}
        </span>
        <span className="truncate">{file.path.split('/').pop()}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0 text-[10px]">
        {file.insertions > 0 && <span className="text-green-500">+{file.insertions}</span>}
        {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
      </div>
    </div>
  )
})

const TreeEntry = memo(function TreeEntry({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.file) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <FileEntry file={node.file} />
      </div>
    )
  }

  return (
    <>
      <div
        className="px-2 py-px text-[11px] text-muted-foreground/50 font-mono"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {node.name}/
      </div>
      {node.children.map((child) => (
        <TreeEntry key={child.path} node={child} depth={depth + 1} />
      ))}
    </>
  )
})

export default function Changes() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const status = useGitStore((s) => s.status)

  const tree = useMemo(
    () => (status ? buildCompactTree(status.files) : []),
    [status],
  )

  if (!isGitRepo) return <NoGitRepo />

  if (!status || status.files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1 text-[11px] text-muted-foreground/60 border-b border-border/30">
        {status.files.length} file{status.files.length !== 1 ? 's' : ''} changed
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeEntry key={node.path} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}
