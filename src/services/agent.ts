/**
 * Agent service — bridges the frontend with the Rust agent backend.
 *
 * Provides:
 * - startTask / abortTask — lifecycle control
 * - getConfig / setConfig — provider management
 * - testConnection — provider validation
 * - Event listening per task (TaskEvent stream from Rust)
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ─── Types mirroring Rust agent::types ───────────────────────────────────────

export type AgentRole = 'implement' | 'research' | 'plan'

export interface TaskScope {
  root_path: string
  files: string[]
  directory?: string
  declarations?: DeclarationInfo[]
  description?: string
}

export interface DeclarationInfo {
  name: string
  kind: string
  file_path: string
  line: number
}

export interface TaskRequest {
  id: string
  prompt: string
  scope: TaskScope
  role: AgentRole
  conversation_id?: string
}

export interface ProviderConfig {
  id: string
  name: string
  endpoint: string
  api_key?: string
  model: string
}

export interface AgentConfig {
  providers: ProviderConfig[]
  active_provider_id: string
}

// Discriminated union matching Rust TaskEvent (serde tag = "type")
export type TaskEvent =
  | { type: 'text'; content: string; partial: boolean }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_start'; tool_name: string; file_path?: string; description?: string }
  | { type: 'tool_end'; tool_name: string; file_path?: string; success: boolean; output?: string }
  | { type: 'followup'; question: string; options?: string[] }
  | { type: 'error'; message: string }
  | { type: 'complete' }
  | { type: 'interrupted'; reason: string }

// ─── Tauri command wrappers ──────────────────────────────────────────────────

export async function startTask(request: TaskRequest): Promise<void> {
  await invoke('agent_start_task', { request })
}

export async function abortTask(taskId: string): Promise<void> {
  await invoke('agent_abort', { taskId })
}

export async function getConfig(): Promise<AgentConfig> {
  return invoke<AgentConfig>('agent_get_config')
}

export async function setConfig(config: AgentConfig): Promise<void> {
  await invoke('agent_set_config', { config })
}

export async function testConnection(config: ProviderConfig): Promise<string[]> {
  return invoke<string[]>('agent_test_connection', { config })
}

// ─── Event subscription ──────────────────────────────────────────────────────

/**
 * Subscribe to events for a specific task. Returns an unsubscribe function.
 * Events are emitted by Rust on the `agent-task-event:{taskId}` channel.
 */
export function listenToTask(
  taskId: string,
  callback: (event: TaskEvent) => void,
): () => void {
  let unlisten: UnlistenFn | null = null

  listen<TaskEvent>(`agent-task-event:${taskId}`, (e) => {
    callback(e.payload)
  }).then((fn) => {
    unlisten = fn
  })

  return () => {
    unlisten?.()
  }
}
