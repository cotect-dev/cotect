import type { Provider } from '@/services/db'

export interface DetectedView {
  server_type: string
  models: { id: string; family: string | null; context: number | null }[]
  capabilities: string[]
  format_per_model: Record<string, string>
}

export interface HealthView {
  state: 'Healthy' | 'Degraded' | 'Unhealthy'
  consecutive_failures: number
  last_ok_at_ms: number | null
  p50_first_token_ms: number | null
  last_error: string | null
}

export function readDetected(p: Provider): DetectedView | null {
  if (!p.detected_json) return null
  try {
    return JSON.parse(p.detected_json) as DetectedView
  } catch {
    return null
  }
}

export function readHealth(p: Provider): HealthView {
  if (!p.health_json)
    return {
      state: 'Healthy',
      consecutive_failures: 0,
      last_ok_at_ms: null,
      p50_first_token_ms: null,
      last_error: null,
    }
  try {
    return JSON.parse(p.health_json) as HealthView
  } catch {
    return {
      state: 'Healthy',
      consecutive_failures: 0,
      last_ok_at_ms: null,
      p50_first_token_ms: null,
      last_error: null,
    }
  }
}
