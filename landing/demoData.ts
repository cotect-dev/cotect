import type { GraphFileNode, GraphFileEdge } from '@/store/graph'
import type { Finding, FileMetrics } from '@/services/structureAnalyzer'
import type { FileChurn, Hotspot } from '@/services/gitAnalysis'
import type { FileSizeInfo } from '@/lib/llmContext'
import type { AppNode } from '@/types/nodes'
import type { Edge } from '@xyflow/react'
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  NODE_H_GAP,
  NODE_V_GAP,
  NODE_V_GAP_SMALL,
} from '@/lib/canvasGeometry'
import type { Column } from '@/store/canvasHelpers'
import { useBrowserStore, useCanvasStore, useGraphStore, useHealthStore } from '@/store'
import { useGitStore } from '@/store/git'
import { DEMO_FILE_PATH, DEMO_HEAD, DEMO_AGENT, DEMO_FILE_CONTENTS } from './demoCode'

export const DEMO_ROOT = '/demo/relay'

// 17 edges (client→routes added to make the circular-dependency finding true)
export const GRAPH_EDGES: GraphFileEdge[] = [
  { source: 'src/index.ts', target: 'src/api/client.ts' },
  { source: 'src/index.ts', target: 'src/api/routes.ts' },
  { source: 'src/index.ts', target: 'src/lib/config.ts' },
  { source: 'src/index.ts', target: 'src/lib/log.ts' },
  { source: 'src/api/client.ts', target: 'src/net/fetchWithRetry.ts' },
  { source: 'src/api/client.ts', target: 'src/net/http.ts' },
  { source: 'src/api/client.ts', target: 'src/lib/log.ts' },
  { source: 'src/api/client.ts', target: 'src/lib/queue.ts' },
  { source: 'src/api/client.ts', target: 'src/api/routes.ts' },
  { source: 'src/api/routes.ts', target: 'src/api/client.ts' },
  { source: 'src/api/routes.ts', target: 'src/lib/log.ts' },
  { source: 'src/net/fetchWithRetry.ts', target: 'src/net/backoff.ts' },
  { source: 'src/net/fetchWithRetry.ts', target: 'src/lib/log.ts' },
  { source: 'src/net/http.ts', target: 'src/lib/log.ts' },
  { source: 'src/lib/config.ts', target: 'src/lib/queue.ts' },
  { source: 'src/net/fetchWithRetry.test.ts', target: 'src/net/fetchWithRetry.ts' },
  { source: 'src/api/client.test.ts', target: 'src/api/client.ts' },
]

// Degrees derived by counting GRAPH_EDGES above:
//   index.ts:         out=4, in=0,  score=4
//   client.ts:        out=5, in=3,  score=8  (largest by charCount too)
//   routes.ts:        out=2, in=2,  score=4
//   config.ts:        out=1, in=1,  score=2
//   log.ts:           out=0, in=5,  score=5  (highest fan-in)
//   fetchWithRetry.ts:out=2, in=2,  score=4
//   http.ts:          out=1, in=1,  score=2
//   queue.ts:         out=0, in=2,  score=2
//   backoff.ts:       out=0, in=1,  score=1
//   fetchWithRetry.test.ts: out=1, in=0, score=1
//   client.test.ts:   out=1, in=0,  score=1
export const GRAPH_NODES: GraphFileNode[] = [
  {
    id: 'src/index.ts',
    label: 'index.ts',
    folder: 'src',
    language: 'typescript',
    inDegree: 0,
    outDegree: 4,
    score: 4,
    isTestFile: false,
    lineCount: 28,
    charCount: 620,
  },
  {
    id: 'src/api/client.ts',
    label: 'client.ts',
    folder: 'src/api',
    language: 'typescript',
    inDegree: 3,
    outDegree: 5,
    score: 8,
    isTestFile: false,
    lineCount: 412,
    charCount: 11200,
  },
  {
    id: 'src/api/routes.ts',
    label: 'routes.ts',
    folder: 'src/api',
    language: 'typescript',
    inDegree: 2,
    outDegree: 2,
    score: 4,
    isTestFile: false,
    lineCount: 94,
    charCount: 2350,
  },
  {
    id: 'src/net/fetchWithRetry.ts',
    label: 'fetchWithRetry.ts',
    folder: 'src/net',
    language: 'typescript',
    inDegree: 2,
    outDegree: 2,
    score: 4,
    isTestFile: false,
    lineCount: 34,
    charCount: 820,
  },
  {
    id: 'src/net/http.ts',
    label: 'http.ts',
    folder: 'src/net',
    language: 'typescript',
    inDegree: 1,
    outDegree: 1,
    score: 2,
    isTestFile: false,
    lineCount: 45,
    charCount: 980,
  },
  {
    id: 'src/net/backoff.ts',
    label: 'backoff.ts',
    folder: 'src/net',
    language: 'typescript',
    inDegree: 1,
    outDegree: 0,
    score: 1,
    isTestFile: false,
    lineCount: 29,
    charCount: 620,
  },
  {
    id: 'src/lib/log.ts',
    label: 'log.ts',
    folder: 'src/lib',
    language: 'typescript',
    inDegree: 5,
    outDegree: 0,
    score: 5,
    isTestFile: false,
    lineCount: 52,
    charCount: 1150,
  },
  {
    id: 'src/lib/config.ts',
    label: 'config.ts',
    folder: 'src/lib',
    language: 'typescript',
    inDegree: 1,
    outDegree: 1,
    score: 2,
    isTestFile: false,
    lineCount: 38,
    charCount: 850,
  },
  {
    id: 'src/lib/queue.ts',
    label: 'queue.ts',
    folder: 'src/lib',
    language: 'typescript',
    inDegree: 2,
    outDegree: 0,
    score: 2,
    isTestFile: false,
    lineCount: 61,
    charCount: 1380,
  },
  {
    id: 'src/net/fetchWithRetry.test.ts',
    label: 'fetchWithRetry.test.ts',
    folder: 'src/net',
    language: 'typescript',
    inDegree: 0,
    outDegree: 1,
    score: 1,
    isTestFile: true,
    lineCount: 48,
    charCount: 1140,
  },
  {
    id: 'src/api/client.test.ts',
    label: 'client.test.ts',
    folder: 'src/api',
    language: 'typescript',
    inDegree: 0,
    outDegree: 1,
    score: 1,
    isTestFile: true,
    lineCount: 72,
    charCount: 1690,
  },
]

const DEMO_NOW_S = Math.floor(Date.now() / 1000)

const demoMetrics: FileMetrics[] = [
  {
    path: 'src/index.ts',
    folder: 'src',
    layer: 'index.ts',
    lineCount: 28,
    inDegree: 0,
    outDegree: 4,
    isTest: false,
    hasTest: false,
    longestChainDepth: 4,
  },
  {
    path: 'src/api/client.ts',
    folder: 'src/api',
    layer: 'api',
    lineCount: 412,
    inDegree: 3,
    outDegree: 5,
    isTest: false,
    hasTest: true,
    longestChainDepth: 3,
  },
  {
    path: 'src/api/routes.ts',
    folder: 'src/api',
    layer: 'api',
    lineCount: 94,
    inDegree: 2,
    outDegree: 2,
    isTest: false,
    hasTest: false,
    longestChainDepth: 3,
  },
  {
    path: 'src/net/fetchWithRetry.ts',
    folder: 'src/net',
    layer: 'net',
    lineCount: 34,
    inDegree: 2,
    outDegree: 2,
    isTest: false,
    hasTest: true,
    longestChainDepth: 2,
  },
  {
    path: 'src/net/http.ts',
    folder: 'src/net',
    layer: 'net',
    lineCount: 45,
    inDegree: 1,
    outDegree: 1,
    isTest: false,
    hasTest: false,
    longestChainDepth: 2,
  },
  {
    path: 'src/net/backoff.ts',
    folder: 'src/net',
    layer: 'net',
    lineCount: 29,
    inDegree: 1,
    outDegree: 0,
    isTest: false,
    hasTest: false,
    longestChainDepth: 1,
  },
  {
    path: 'src/lib/log.ts',
    folder: 'src/lib',
    layer: 'lib',
    lineCount: 52,
    inDegree: 5,
    outDegree: 0,
    isTest: false,
    hasTest: false,
    longestChainDepth: 1,
  },
  {
    path: 'src/lib/config.ts',
    folder: 'src/lib',
    layer: 'lib',
    lineCount: 38,
    inDegree: 1,
    outDegree: 1,
    isTest: false,
    hasTest: false,
    longestChainDepth: 2,
  },
  {
    path: 'src/lib/queue.ts',
    folder: 'src/lib',
    layer: 'lib',
    lineCount: 61,
    inDegree: 2,
    outDegree: 0,
    isTest: false,
    hasTest: false,
    longestChainDepth: 1,
  },
  {
    path: 'src/net/fetchWithRetry.test.ts',
    folder: 'src/net',
    layer: 'net',
    lineCount: 48,
    inDegree: 0,
    outDegree: 1,
    isTest: true,
    hasTest: false,
    longestChainDepth: 1,
  },
  {
    path: 'src/api/client.test.ts',
    folder: 'src/api',
    layer: 'api',
    lineCount: 72,
    inDegree: 0,
    outDegree: 1,
    isTest: true,
    hasTest: false,
    longestChainDepth: 1,
  },
]

const demoFindings: Finding[] = [
  {
    type: 'circular-dependency',
    severity: 'error',
    files: ['src/api/routes.ts', 'src/api/client.ts'],
    message: 'Circular dependency: src/api/routes.ts → src/api/client.ts → src/api/routes.ts',
  },
  {
    type: 'large-file',
    severity: 'info',
    files: ['src/api/client.ts'],
    message: 'client.ts is 412 lines; consider splitting transport and parsing',
  },
  {
    type: 'high-fan-in',
    severity: 'info',
    files: ['src/lib/log.ts'],
    message: 'log.ts is imported by 5 modules',
    detail: { count: 5 },
  },
  {
    type: 'missing-test',
    severity: 'info',
    files: ['src/lib/queue.ts'],
    message: 'Missing test: src/lib/queue.ts has no corresponding test file',
  },
]

const demoChurn: FileChurn[] = [
  {
    path: 'src/net/fetchWithRetry.ts',
    commitCount: 18,
    totalInsertions: 142,
    totalDeletions: 87,
    lastModified: DEMO_NOW_S - 3600,
  },
  {
    path: 'src/api/client.ts',
    commitCount: 14,
    totalInsertions: 310,
    totalDeletions: 198,
    lastModified: DEMO_NOW_S - 7200,
  },
  {
    path: 'src/api/routes.ts',
    commitCount: 9,
    totalInsertions: 98,
    totalDeletions: 52,
    lastModified: DEMO_NOW_S - 86400,
  },
  {
    path: 'src/lib/log.ts',
    commitCount: 6,
    totalInsertions: 41,
    totalDeletions: 18,
    lastModified: DEMO_NOW_S - 172800,
  },
  {
    path: 'src/lib/queue.ts',
    commitCount: 5,
    totalInsertions: 67,
    totalDeletions: 34,
    lastModified: DEMO_NOW_S - 259200,
  },
  {
    path: 'src/lib/config.ts',
    commitCount: 3,
    totalInsertions: 22,
    totalDeletions: 9,
    lastModified: DEMO_NOW_S - 432000,
  },
]

// Derive hotspots from canonical sources (demoChurn + GRAPH_NODES) so lineCount,
// inDegree, and commitCount never drift from the data they depend on.
// MAX_CHURN = max commitCount across demoChurn entries (18 = fetchWithRetry)
// MAX_LINES = max lineCount across non-test GRAPH_NODES (412 = client.ts)
// Sorted by hotspotScore desc: client(≈0.778) > routes(≈0.114) > fetchWithRetry(≈0.083) > log(≈0.042) > queue(≈0.041) > config(≈0.015)
const _nodeById = new Map(GRAPH_NODES.map((n) => [n.id, n]))
const MAX_CHURN = Math.max(...demoChurn.map((c) => c.commitCount))
const MAX_LINES = Math.max(...GRAPH_NODES.filter((n) => !n.isTestFile).map((n) => n.lineCount), 1)
const demoHotspots: Hotspot[] = demoChurn
  .filter((c) => {
    const node = _nodeById.get(c.path)
    return node && !node.isTestFile && c.commitCount >= 2 && node.lineCount > 0
  })
  .map((c) => {
    const node = _nodeById.get(c.path)!
    const churnScore = c.commitCount / MAX_CHURN
    const sizeScore = node.lineCount / MAX_LINES
    return {
      path: c.path,
      commitCount: c.commitCount,
      lineCount: node.lineCount,
      inDegree: node.inDegree,
      churnScore,
      sizeScore,
      hotspotScore: churnScore * sizeScore,
    }
  })
  .sort((a, b) => b.hotspotScore - a.hotspotScore)

const demoFileSizes: FileSizeInfo[] = GRAPH_NODES.filter((n) => !n.isTestFile)
  .map((n) => {
    const tokens = Math.ceil(n.charCount / 4)
    return {
      path: n.id,
      lineCount: n.lineCount,
      tokens,
      contextFraction: tokens / 200_000,
      isRisky: tokens >= 8_000,
    }
  })
  .sort((a, b) => b.tokens - a.tokens)

export const HEALTH_DATA = {
  findings: demoFindings,
  metrics: demoMetrics,
  churn: demoChurn,
  hotspots: demoHotspots,
  fileSizes: demoFileSizes,
}

// Canvas geometry constants (match flattenAndRender: xOffset = colIndex * (NODE_WIDTH + NODE_H_GAP))
const COL_STEP = NODE_WIDTH + NODE_H_GAP

function makeFileNode(id: string, label: string, isTestFile?: boolean): AppNode {
  return {
    id,
    type: 'file',
    position: { x: 0, y: 0 },
    data: { label, path: id, isTestFile },
  }
}

function makeFolderNode(id: string, label: string, childCount?: number): AppNode {
  return {
    id,
    type: 'folder',
    position: { x: 0, y: 0 },
    data: { label, path: id, isDirectory: true as const, childCount },
  }
}

function positionNodes(nodes: AppNode[], xOffset: number): AppNode[] {
  let y = 0
  return nodes.map((node, i) => {
    const placed = { ...node, position: { x: xOffset, y } }
    const next = nodes[i + 1]
    const sameGroup = !next || (node.type === 'folder') === (next.type === 'folder')
    y += NODE_HEIGHT + (sameGroup ? NODE_V_GAP_SMALL : NODE_V_GAP)
    return placed
  })
}

// Node IDs for autoplay targets
const SRC_FOLDER_ID = `${DEMO_ROOT}/src`
const NET_FOLDER_ID = `${DEMO_ROOT}/src/net`
const CHANGED_FILE_ID = `${DEMO_ROOT}/src/net/fetchWithRetry.ts`
const CODE_NODE_ID = `code:${DEMO_ROOT}/${DEMO_FILE_PATH}:demo`

export const DEMO_SCRIPT_IDS = {
  srcFolder: SRC_FOLDER_ID,
  netFolder: NET_FOLDER_ID,
  changedFile: CHANGED_FILE_ID,
}

export function buildCanvasSeed(): {
  columns: Column[]
  nodes: AppNode[]
  edges: Edge[]
  focusedNodeId: string
  previewByPath: Record<string, Column>
} {
  // Col 0: /demo/relay root listing
  const col0Nodes = positionNodes(
    [
      makeFolderNode(SRC_FOLDER_ID, 'src', 4),
      makeFileNode(`${DEMO_ROOT}/package.json`, 'package.json'),
      makeFileNode(`${DEMO_ROOT}/README.md`, 'README.md'),
    ],
    0 * COL_STEP,
  )

  // Col 1: /demo/relay/src listing
  const col1Nodes = positionNodes(
    [
      makeFolderNode(`${DEMO_ROOT}/src/api`, 'api', 3),
      makeFolderNode(`${DEMO_ROOT}/src/lib`, 'lib', 3),
      makeFolderNode(NET_FOLDER_ID, 'net', 4),
      makeFileNode(`${DEMO_ROOT}/src/index.ts`, 'index.ts'),
    ],
    1 * COL_STEP,
  )

  // Col 2: /demo/relay/src/net listing
  const col2Nodes = positionNodes(
    [
      makeFileNode(`${DEMO_ROOT}/src/net/backoff.ts`, 'backoff.ts'),
      makeFileNode(CHANGED_FILE_ID, 'fetchWithRetry.ts'),
      makeFileNode(`${DEMO_ROOT}/src/net/http.ts`, 'http.ts'),
      makeFileNode(`${DEMO_ROOT}/src/net/fetchWithRetry.test.ts`, 'fetchWithRetry.test.ts', true),
    ],
    2 * COL_STEP,
  )

  // Col 3: code node for the agent-changed file
  const endLine = DEMO_AGENT.split('\n').length
  const codeNode: AppNode = {
    id: CODE_NODE_ID,
    type: 'codeNode',
    position: { x: 3 * COL_STEP, y: 0 },
    data: {
      label: 'fetchWithRetry.ts',
      filePath: `${DEMO_ROOT}/${DEMO_FILE_PATH}`,
      code: DEMO_AGENT,
      startLine: 1,
      endLine,
      headOverride: DEMO_HEAD,
      review: { filePath: DEMO_FILE_PATH },
    },
  }

  const col0: Column = { path: DEMO_ROOT, kind: 'directory', nodes: col0Nodes, edges: [] }
  const col1: Column = { path: `${DEMO_ROOT}/src`, kind: 'directory', nodes: col1Nodes, edges: [] }
  const col2: Column = {
    path: `${DEMO_ROOT}/src/net`,
    kind: 'directory',
    nodes: col2Nodes,
    edges: [],
  }
  const col3: Column = {
    path: `${DEMO_ROOT}/${DEMO_FILE_PATH}`,
    kind: 'file',
    nodes: [codeNode],
    edges: [],
  }

  // Preset previews for WASD browsing: the sibling folder listings (api, lib)
  // plus the seeded chain's own columns, so refocusing a folder restores its
  // listing instead of dead-ending. Plain files fall back to the seeded
  // head-content cache at navigation time.
  const apiCol: Column = {
    path: `${DEMO_ROOT}/src/api`,
    kind: 'directory',
    nodes: positionNodes(
      [
        makeFileNode(`${DEMO_ROOT}/src/api/client.ts`, 'client.ts'),
        makeFileNode(`${DEMO_ROOT}/src/api/routes.ts`, 'routes.ts'),
        makeFileNode(`${DEMO_ROOT}/src/api/client.test.ts`, 'client.test.ts', true),
      ],
      2 * COL_STEP,
    ),
    edges: [],
  }
  const libCol: Column = {
    path: `${DEMO_ROOT}/src/lib`,
    kind: 'directory',
    nodes: positionNodes(
      [
        makeFileNode(`${DEMO_ROOT}/src/lib/config.ts`, 'config.ts'),
        makeFileNode(`${DEMO_ROOT}/src/lib/log.ts`, 'log.ts'),
        makeFileNode(`${DEMO_ROOT}/src/lib/queue.ts`, 'queue.ts'),
      ],
      2 * COL_STEP,
    ),
    edges: [],
  }
  const previewByPath: Record<string, Column> = {
    [col1.path]: col1,
    [col2.path]: col2,
    [col3.path]: col3,
    [apiCol.path]: apiCol,
    [libCol.path]: libCol,
  }

  const allNodes = [...col0Nodes, ...col1Nodes, ...col2Nodes, codeNode]

  // Inter-column edges (same convention as flattenAndRender: focused node in col i → focused in col i+1).
  // The full drill-in chain is pre-drawn so the static first paint already shows
  // every connector; the autoplay just walks focus along it from col 0 onward.
  const EDGE_STYLE = { stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1.5 }
  const edges: Edge[] = [
    {
      id: `edge:col0:${SRC_FOLDER_ID}->${NET_FOLDER_ID}`,
      source: SRC_FOLDER_ID,
      sourceHandle: 'right',
      target: NET_FOLDER_ID,
      targetHandle: 'left',
      type: 'column',
      animated: true,
      style: EDGE_STYLE,
    },
    {
      id: `edge:col1:${NET_FOLDER_ID}->${CHANGED_FILE_ID}`,
      source: NET_FOLDER_ID,
      sourceHandle: 'right',
      target: CHANGED_FILE_ID,
      targetHandle: 'left',
      type: 'column',
      animated: true,
      style: EDGE_STYLE,
    },
    {
      id: `edge:col2:${CHANGED_FILE_ID}->${CODE_NODE_ID}`,
      source: CHANGED_FILE_ID,
      sourceHandle: 'rightTitle',
      target: CODE_NODE_ID,
      targetHandle: 'title',
      type: 'column',
      animated: true,
      style: EDGE_STYLE,
    },
  ]

  return {
    columns: [col0, col1, col2, col3],
    nodes: allNodes,
    edges,
    // Start at the very beginning of the chain (root listing, src folder
    // focused) so the autoplay drills forward instead of opening on the end
    // state and jumping back to col 0.
    focusedNodeId: SRC_FOLDER_ID,
    previewByPath,
  }
}

const DEMO_COMMIT_HASH = 'a1b2c3d'

export function seedDemoStores(): void {
  const { columns, nodes, edges, focusedNodeId, previewByPath } = buildCanvasSeed()

  useBrowserStore.setState({ rootPath: DEMO_ROOT })

  useCanvasStore.setState({
    columns,
    nodes,
    edges,
    focusedNodeId,
    currentColumnIndex: 0,
    depthChain: [DEMO_ROOT],
    viewportHeight: 600,
    mdPreviewEnabled: false,
    previewReady: true,
    demoSeed: { previewByPath, columns },
  })

  useGraphStore.setState({
    scanState: 'ready',
    scannedCount: GRAPH_NODES.length,
    errorMessage: null,
    allNodes: GRAPH_NODES,
    allEdges: GRAPH_EDGES,
  })

  useHealthStore.setState({
    scanState: 'ready',
    errorMessage: null,
    lastAnalyzedAt: Date.now(),
    progress: null,
    analyzedRoot: DEMO_ROOT,
    findings: HEALTH_DATA.findings,
    metrics: HEALTH_DATA.metrics,
    churn: HEALTH_DATA.churn,
    hotspots: HEALTH_DATA.hotspots,
    fileSizes: HEALTH_DATA.fileSizes,
  })

  useGitStore.setState({
    repoPath: DEMO_ROOT,
    initialized: true,
    isGitRepo: true,
    gitError: null,
    branch: { kind: 'branch', name: 'main' },
    branches: ['main'],
    lastCommitTimestamp: DEMO_NOW_S - 3600,
    log: [
      {
        hash: DEMO_COMMIT_HASH,
        message: 'feat: fetch helper with bounded retries',
        body: '',
        author: 'dev',
        timestamp: DEMO_NOW_S - 3600,
        insertions: 24,
        deletions: 8,
        files: [
          { path: DEMO_FILE_PATH, insertions: 19, deletions: 6 },
          { path: 'src/net/fetchWithRetry.test.ts', insertions: 5, deletions: 2 },
        ],
      },
      {
        hash: 'f7e21b9',
        message: 'fix: drop queued messages over the size limit',
        body: '',
        author: 'dev',
        timestamp: DEMO_NOW_S - 10800,
        insertions: 14,
        deletions: 3,
        files: [{ path: 'src/lib/queue.ts', insertions: 14, deletions: 3 }],
      },
      {
        hash: 'c09d4ae',
        message: 'feat: route registry wired into the client',
        body: '',
        author: 'dev',
        timestamp: DEMO_NOW_S - 86400,
        insertions: 57,
        deletions: 2,
        files: [
          { path: 'src/api/routes.ts', insertions: 48, deletions: 0 },
          { path: 'src/api/client.ts', insertions: 9, deletions: 2 },
        ],
      },
      {
        hash: 'b3a8f10',
        message: 'feat: http client and structured logging',
        body: '',
        author: 'dev',
        timestamp: DEMO_NOW_S - 172800,
        insertions: 89,
        deletions: 0,
        files: [
          { path: 'src/net/http.ts', insertions: 61, deletions: 0 },
          { path: 'src/lib/log.ts', insertions: 28, deletions: 0 },
        ],
      },
      {
        hash: '9d51c77',
        message: 'chore: project scaffolding',
        body: '',
        author: 'dev',
        timestamp: DEMO_NOW_S - 259200,
        insertions: 51,
        deletions: 0,
        files: [
          { path: 'src/index.ts', insertions: 32, deletions: 0 },
          { path: 'src/lib/config.ts', insertions: 19, deletions: 0 },
        ],
      },
    ],
    headContent: {
      sha: DEMO_COMMIT_HASH,
      // Every browsable file, so WASD previews resolve from this cache. The
      // changed file maps to its pre-agent content (the diff base).
      files: { ...DEMO_FILE_CONTENTS, [DEMO_FILE_PATH]: DEMO_HEAD },
    },
    status: {
      files: [{ path: DEMO_FILE_PATH, status: 'M', insertions: 4, deletions: 2 }],
      total_insertions: 4,
      total_deletions: 2,
    },
    workingDiff: [
      {
        path: DEMO_FILE_PATH,
        status: 'M',
        insertions: 4,
        deletions: 2,
        // Exactly the merge chunks of DEMO_HEAD vs DEMO_AGENT (computed via
        // Chunk.build, after-side line numbers). They must match the editor's
        // chunk starts: review progress is keyed by hunkKey(path, startLine),
        // so the Changes panel only tracks accepts when these agree.
        //   hunk 1 (line 4): interface gains maxDelayMs
        //   hunk 2 (line 11): defaults change, retries silently 3 -> 5
        //   hunk 3 (lines 21-22): capped exponential backoff with jitter
        hunks: [
          { start_line: 4, line_count: 1 },
          { start_line: 11, line_count: 1 },
          { start_line: 21, line_count: 2 },
        ],
      },
    ],
    fileTimes: { [DEMO_FILE_PATH]: DEMO_NOW_S - 3600 },
    sortMode: 'path',
    loading: false,
  })
}
