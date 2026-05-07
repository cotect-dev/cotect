export interface ProbeInput {
  endpoint: string
  api_key: string | null
}

export interface DetectedModel {
  id: string
  family: string | null
  context: number | null
}

export interface Probed {
  normalized_endpoint: string
  server_type: string
  models: DetectedModel[]
  capabilities: string[]
  format_per_model: Record<string, string>
  probe_ms: number
}
