import { invoke } from '@tauri-apps/api/core'

// Mirrors Rust db::providers::Provider
export interface Provider {
  id: string
  label: string
  endpoint: string
  api_key: string | null
  detected_json: string | null
  health_json: string | null
  position: number
}

export interface ActiveAssignment {
  default_provider_id: string | null
  default_model: string | null
  implement_provider_id: string | null
  implement_model: string | null
  research_provider_id: string | null
  research_model: string | null
  plan_provider_id: string | null
  plan_model: string | null
}

export interface UsageRecord {
  ts: number
  provider_id: string
  model: string
  role: string
  task_id: string | null
  prompt_tokens: number
  completion_tokens: number
  first_token_ms: number | null
  total_ms: number | null
  ok: boolean
  tokens_estimated: boolean
}

export interface UsageFilter {
  from_ts: number | null
  to_ts: number | null
  provider_id: string | null
  model: string | null
  role: string | null
  limit: number | null
}

export type GroupBy = 'Provider' | 'Model' | 'Role' | 'Day' | 'ProviderDay' | 'RoleDay'

export interface AggregateRow {
  bucket: string
  tasks: number
  prompt_tokens: number
  completion_tokens: number
  p50_total_ms: number | null
}

// kv
export const kvGet = (key: string) => invoke<unknown>('kv_get', { key })
export const kvSet = (key: string, value: unknown) => invoke<void>('kv_set', { key, value })
export const kvDelete = (key: string) => invoke<void>('kv_delete', { key })
export const kvGetPrefix = (prefix: string) => invoke<Record<string, unknown>>('kv_get_prefix', { prefix })

// providers
export const providersList = () => invoke<Provider[]>('providers_list')
export const providersUpsert = (provider: Provider) => invoke<void>('providers_upsert', { provider })
export const providersRemove = (id: string) => invoke<void>('providers_remove', { id })
export const assignmentGet = () => invoke<ActiveAssignment>('assignment_get')
export const assignmentSet = (assignment: ActiveAssignment) => invoke<void>('assignment_set', { assignment })

// repos (Project Map scaffold)
export const dbRepoUpsert = (rootPath: string) => invoke<number>('db_repo_upsert', { rootPath })
export const dbRepoGet = (rootPath: string) => invoke<{ id: number; root_path: string } | null>('db_repo_get', { rootPath })

// usage
export const usageRecord = (record: UsageRecord) => invoke<void>('usage_record', { record })
export const usageQuery = (filter: UsageFilter) => invoke<UsageRecord[]>('usage_query', { filter })
export const usageAggregate = (filter: UsageFilter, groupBy: GroupBy) => invoke<AggregateRow[]>('usage_aggregate', { filter, groupBy })
export const usagePurge = (beforeTs: number) => invoke<number>('usage_purge', { beforeTs })
