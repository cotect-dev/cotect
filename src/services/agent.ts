import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

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
  format?: string
  disable_thinking?: boolean
}

export interface AgentConfig {
  providers: ProviderConfig[]
  active_provider_id: string
}

// Mirrors `serde(tag = "type")` on the Rust side.
export type TaskEvent =
  | { type: 'text'; content: string; partial: boolean }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_start'; tool_name: string; file_path?: string; description?: string }
  | { type: 'tool_end'; tool_name: string; file_path?: string; success: boolean; output?: string }
  | { type: 'followup'; question: string; options?: string[] }
  | { type: 'error'; message: string }
  | { type: 'complete' }
  | { type: 'interrupted'; reason: string }
  // One-shot signal: model has streamed reasoning for a long time without
  // calling a tool. Advisory only; not a circuit-breaker.
  | { type: 'reasoning_stall'; elapsed_ms: number; reasoning_bytes: number }

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

/** Listens on the `agent-task-event:{taskId}` Tauri event. */
export function listenToTask(
  taskId: string,
  callback: (event: TaskEvent) => void,
): () => void {
  const promise = listen<TaskEvent>(`agent-task-event:${taskId}`, (e) => {
    callback(e.payload)
  })
  promise.catch((err) => {
    console.warn(`[agent] failed to attach listener for task "${taskId}":`, err)
  })
  return () => {
    promise.then((fn) => fn()).catch((err) => {
      console.warn(`[agent] failed to detach listener for task "${taskId}":`, err)
    })
  }
}
