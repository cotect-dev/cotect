import type { Edge } from '@xyflow/react'
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { NODE_WIDTH, NODE_HEIGHT, NODE_V_GAP, NODE_V_GAP_SMALL } from '@/lib/canvasGeometry'
import { getImageMimeType, IMAGE_PREVIEW_MAX_BYTES } from '@/lib/fileClassification'
import { isTestFile } from '@/lib/fileClassification'
import { joinPath, toRepoRelative } from '@/lib/repoPath'
import type { AppNode } from '@/types/nodes'
import { useGitStore } from '@/store/git'
import { useGraphStore } from '@/store/graph'
import { parseImportsWithLines, parseImportsWithBindings } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { getConfigForFile } from '@/services/treesitter-queries'

export type ImportRefKind = 'import' | 'imported-by'

export interface ImportRef {
  resolvedPath: string
  label: string
  line: number
  visualLine: number
  kind: ImportRefKind
  importedNames?: string[]
}

export interface Column {
  path: string
  kind: 'directory' | 'file'
  nodes: AppNode[]
  edges: Edge[]
  importRefs?: ImportRef[]
}

export async function buildDirectoryNodes(dirPath: string): Promise<AppNode[]> {
  const platform = getPlatform()
  const rawEntries = await platform.fs.readDirectory(dirPath)
  const entries = rawEntries.filter(
    (e) => !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.')),
  )

  const folders = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const regularFiles = entries
    .filter((e) => !e.isDirectory && !isTestFile(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const testFiles = entries
    .filter((e) => !e.isDirectory && isTestFile(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...folders, ...regularFiles, ...testFiles]

  const childCountMap = new Map<string, number>()
  await Promise.all(
    folders.map(async (folder) => {
      try {
        const children = await platform.fs.readDirectory(folder.path)
        const visible = children.filter(
          (e) => !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.')),
        )
        childCountMap.set(folder.path, visible.length)
      } catch {
        /* unreadable directory */
      }
    }),
  )

  return sorted.map(
    (entry): AppNode =>
      entry.isDirectory
        ? {
            id: entry.path,
            type: 'folder',
            position: { x: 0, y: 0 },
            data: {
              label: entry.name,
              path: entry.path,
              isDirectory: true as const,
              childCount: childCountMap.get(entry.path),
            },
          }
        : {
            id: entry.path,
            type: 'file',
            position: { x: 0, y: 0 },
            data: { label: entry.name, path: entry.path, isTestFile: isTestFile(entry.name) },
          },
  )
}

export async function buildFileNode(filePath: string): Promise<AppNode> {
  const platform = getPlatform()
  const content = await platform.fs.readFile(filePath)
  const fileName = filePath.split('/').pop() || filePath
  const lineCount = content.split('\n').length

  return {
    id: `code:${filePath}:__full__`,
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: {
      label: fileName,
      filePath,
      code: content,
      startLine: 1,
      endLine: lineCount,
    },
  }
}

export async function buildHeadFallbackNode(filePath: string): Promise<AppNode | null> {
  const { repoPath, loadHeadContent } = useGitStore.getState()
  if (!repoPath) return null
  const repoRel = toRepoRelative(filePath, repoPath)
  const headContent = await loadHeadContent(repoRel)
  if (headContent === null) return null
  const fileName = filePath.split('/').pop() || filePath
  const lineCount = headContent.split('\n').length
  return {
    id: `code:${filePath}:__head__`,
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: { label: fileName, filePath, code: headContent, startLine: 1, endLine: lineCount },
  }
}

export async function buildImageNode(filePath: string): Promise<AppNode | null> {
  const platform = getPlatform()
  const bytes = await platform.fs.readBinaryFile(filePath)
  const fileName = filePath.split('/').pop() || filePath

  if (bytes.length > IMAGE_PREVIEW_MAX_BYTES) {
    return null
  }

  const mime = getImageMimeType(fileName)

  const CHUNK = 8192
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }
  const base64 = btoa(chunks.join(''))
  const dataUrl = `data:${mime};base64,${base64}`

  return {
    id: `image:${filePath}`,
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      label: fileName,
      filePath,
      dataUrl,
    },
  }
}

function computeVisualLineMap(headContent: string, workingContent: string): number[] {
  const a = headContent.split('\n')
  const b = workingContent.split('\n')
  const n = a.length
  const m = b.length

  if (n > 2000 || m > 2000) return b.map((_, i) => i)

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const headMatched = new Array(n).fill(false)
  const workMatched = new Array(m).fill(false)
  let i = n,
    j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      headMatched[i - 1] = true
      workMatched[j - 1] = true
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  const visualMap: number[] = new Array(m)
  let hi = 0
  let deletedAbove = 0
  for (let wi = 0; wi < m; wi++) {
    if (workMatched[wi]) {
      while (hi < n && !headMatched[hi]) {
        deletedAbove++
        hi++
      }
      hi++
    }
    visualMap[wi] = wi + deletedAbove
  }
  return visualMap
}

export async function resolveFileImportRefs(
  filePath: string,
  codeNode: AppNode,
): Promise<ImportRef[]> {
  if (codeNode.type !== 'codeNode') return []

  const gitState = useGitStore.getState()
  const { repoPath } = gitState
  if (!repoPath) return []

  const repoRel = toRepoRelative(filePath, repoPath)
  const config = getConfigForFile(repoRel)
  if (!config) return []

  const { allNodes, allEdges, scanState } = useGraphStore.getState()
  if (scanState !== 'ready' || allNodes.length === 0) return []

  const knownFiles = new Set(allNodes.map((n) => n.id))
  const source = codeNode.data.code

  let vmap: number[] | null = null
  const gitEntry = gitState.status?.files.find((f) => f.path === repoRel)
  if (gitEntry && gitEntry.status !== 'A' && gitEntry.status !== 'U') {
    const headContent = await gitState.loadHeadContent(repoRel)
    if (headContent !== null) {
      vmap = computeVisualLineMap(headContent, source)
    }
  }

  const toVisual = (srcLine: number) => {
    if (!vmap) return srcLine
    const idx = srcLine - 1
    return idx >= 0 && idx < vmap.length ? vmap[idx] + 1 : srcLine
  }

  const importLines = await parseImportsWithLines(repoRel, source)
  const refs: ImportRef[] = []
  const seen = new Set<string>()
  for (const imp of importLines) {
    const resolved = resolveImport(imp.specifier, repoRel, knownFiles, config.id)
    if (!resolved || resolved === repoRel) continue
    if (seen.has(resolved)) continue
    const label = resolved.split('/').pop() || resolved
    if (isTestFile(label)) continue
    seen.add(resolved)
    refs.push({
      resolvedPath: resolved,
      label,
      line: imp.line,
      visualLine: toVisual(imp.line),
      kind: 'import',
    })
  }

  const directImporters = allEdges
    .filter((e) => e.target === repoRel && e.source !== repoRel)
    .filter((e) => !isTestFile(e.source.split('/').pop() || e.source))
    .map((e) => e.source)

  if (directImporters.length > 0) {
    const sourceLines = source.split('\n')
    const exportMap = new Map<string, number>()
    let firstExportLine: number | null = null
    for (let li = 0; li < sourceLines.length; li++) {
      const trimmed = sourceLines[li].trimStart()
      if (!trimmed.startsWith('export ')) continue
      if (firstExportLine === null) firstExportLine = li + 1
      if (trimmed.includes(' from ')) continue
      const m = trimmed.match(
        /^export\s+(?:declare\s+)?(?:default\s+)?(?:type|interface|const|let|var|function|async\s+function|class|enum|abstract\s+class)\s+(\w+)/,
      )
      if (m) exportMap.set(m[1], li + 1)
    }

    let fallbackAnchor = refs.length > 0 ? refs[refs.length - 1].line + 1 : 1
    if (exportMap.size > 0) {
      fallbackAnchor = Math.min(...exportMap.values())
    } else if (firstExportLine !== null) {
      fallbackAnchor = firstExportLine
    }

    const platform = getPlatform()
    const directBindings = await Promise.all(
      directImporters.map(async (imp): Promise<{ imp: string; names: string[] }> => {
        try {
          const absPath = joinPath(repoPath, imp)
          const impSource = await platform.fs.readFile(absPath)
          const impConfig = getConfigForFile(imp)
          if (!impConfig) return { imp, names: [] }
          const bindings = await parseImportsWithBindings(imp, impSource)
          const names: string[] = []
          for (const b of bindings) {
            const resolved = resolveImport(b.specifier, imp, knownFiles, impConfig.id)
            if (resolved === repoRel) names.push(...b.names)
          }
          return { imp, names }
        } catch {
          return { imp, names: [] }
        }
      }),
    )

    const exportedNames = new Set(exportMap.keys())
    const directImporterSet = new Set(directImporters)
    const transitiveBindings: { imp: string; names: string[] }[] = []

    for (const { imp: middleFile, names: middleNames } of directBindings) {
      const reExported = middleNames.filter((n) => exportedNames.has(n))
      if (reExported.length === 0) continue
      const reExportSet = new Set(reExported)

      const consumers = allEdges
        .filter(
          (e) =>
            e.target === middleFile && e.source !== repoRel && !directImporterSet.has(e.source),
        )
        .filter((e) => !isTestFile(e.source.split('/').pop() || e.source))
        .map((e) => e.source)

      if (consumers.length === 0) continue

      const resolved = await Promise.all(
        consumers.map(async (consumer): Promise<{ imp: string; names: string[] } | null> => {
          try {
            const absPath = joinPath(repoPath, consumer)
            const src = await platform.fs.readFile(absPath)
            const cfg = getConfigForFile(consumer)
            if (!cfg) return null
            const bindings = await parseImportsWithBindings(consumer, src)
            const matchedNames: string[] = []
            for (const b of bindings) {
              const res = resolveImport(b.specifier, consumer, knownFiles, cfg.id)
              if (res === middleFile) {
                matchedNames.push(...b.names.filter((n) => reExportSet.has(n)))
              }
            }
            return matchedNames.length > 0 ? { imp: consumer, names: matchedNames } : null
          } catch {
            return null
          }
        }),
      )

      for (const r of resolved) if (r) transitiveBindings.push(r)
    }

    const allBindings = [...directBindings, ...transitiveBindings]

    for (const { imp, names } of allBindings) {
      if (seen.has(imp)) continue
      seen.add(imp)
      const label = imp.split('/').pop() || imp

      const byLine = new Map<number, string[]>()
      for (const name of names) {
        const exportLine = exportMap.get(name)
        if (exportLine !== undefined) {
          if (!byLine.has(exportLine)) byLine.set(exportLine, [])
          byLine.get(exportLine)!.push(name)
        }
      }

      if (byLine.size > 0) {
        for (const [anchorLine, lineNames] of byLine) {
          refs.push({
            resolvedPath: imp,
            label,
            line: anchorLine,
            visualLine: toVisual(anchorLine),
            kind: 'imported-by',
            importedNames: lineNames,
          })
        }
      } else {
        refs.push({
          resolvedPath: imp,
          label,
          line: fallbackAnchor,
          visualLine: toVisual(fallbackAnchor),
          kind: 'imported-by',
          importedNames: names.length > 0 ? names : undefined,
        })
      }
    }
  }

  return refs
}

export function positionColumnNodes(
  nodes: AppNode[],
  xOffset: number,
  yStart: number = 0,
): { positioned: AppNode[]; yById: Map<string, number> } {
  let y = yStart
  const yById = new Map<string, number>()
  const positioned = nodes.map((node, i) => {
    yById.set(node.id, y)
    const placed = { ...node, position: { x: xOffset, y } }
    const next = nodes[i + 1]
    const sameGroup = !next || (node.type === 'folder') === (next.type === 'folder')
    y += NODE_HEIGHT + (sameGroup ? NODE_V_GAP_SMALL : NODE_V_GAP)
    return placed
  })
  return { positioned, yById }
}

export function findVerticalNeighbor(
  allNodes: AppNode[],
  focusedId: string,
  direction: 'up' | 'down',
): string | null {
  const focused = allNodes.find((n) => n.id === focusedId)
  if (!focused) return null

  const fx = focused.position.x
  const fy = focused.position.y

  const sameCol = allNodes.filter(
    (n) => n.id !== focusedId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5,
  )

  let bestId: string | null = null
  let bestDist = Infinity

  for (const node of sameCol) {
    const dy = node.position.y - fy
    const inDirection = direction === 'up' ? dy < 0 : dy > 0
    if (inDirection && Math.abs(dy) < bestDist) {
      bestDist = Math.abs(dy)
      bestId = node.id
    }
  }

  return bestId
}
