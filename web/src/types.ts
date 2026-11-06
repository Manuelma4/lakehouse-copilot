export type Sport = 'football' | 'valorant'
export type View =
  'overview' | 'events' | 'forecasts' | 'teams' | 'copilot' | 'quality' | 'open-football' | 'live'
export interface Manifest {
  schema_version: string
  dataset_version: string
  data_kind: string
  as_of: string
  producer_version?: string
  providers?: string[]
}
export interface Match {
  match_id: string
  sport: Sport
  team_a: string
  team_b: string
  start_time: string
  status: string
  score_a: number | null
  score_b: number | null
  competition: string
  best_of: number
  observed_at: string
  revision: number
  team_a_id?: string | null
  team_b_id?: string | null
  provider?: string
  completed_at?: string | null
}
export interface Team {
  team_id: string
  sport: Sport
  team_name: string
  matches: number
  wins: number
  draws: number
  losses: number
  score_for: number
  score_against: number
  win_rate: number
  last_match_at: string
}
export interface Prediction {
  match_id: string
  sport: Sport
  team_a: string
  team_b: string
  start_time: string
  model: string
  probabilities: { a: number; b: number; draw?: number }
  data_kind: string
  as_of: string
  limitations: string
  evidence: Record<string, number | string>
}
export interface Metrics {
  samples: number
  accuracy: number
  log_loss: number
  multiclass_brier: number
}
export interface ModelCard {
  status: string
  data_kind?: string
  model?: string
  split?: string
  calibration?: string
  feature_names?: string[]
  train_samples?: number
  test?: { model: Metrics; frequency_baseline: Metrics }
  validation?: { model: Metrics; frequency_baseline: Metrics }
  reason?: string
}
export interface Quality {
  checks: { rule: string; table: string; passed: number; failed: number; severity: string }[]
  summary: { valid_events: number; quarantined: number; last_run_status: string }
  run_id?: string
}
export interface Incident {
  incident_id: string
  severity: string
  description: string
  status: string
  table: string
  rule: string
  remediation: string
  event_count: number
}
export interface Document {
  id: string
  title: string
  text: string
}
export interface Lineage {
  source: string
  target: string
  transformation: string
}
export interface Catalog {
  name: string
  layer: string
  description: string
  columns: { name: string; type: string; description: string }[]
}
export interface OverviewSummary {
  total_matches: number
  completed_matches: number
  upcoming_matches: number
  teams: number
  predictions: number
  quarantined_events: number
}
export interface Snapshot {
  manifest: Manifest
  matches: Match[]
  teams: Team[]
  predictions: Prediction[]
  model_report: { data_kind?: string; sports: Partial<Record<Sport, ModelCard>> }
  quality: Quality
  incidents: Incident[]
  catalog: Catalog[]
  lineage: Lineage[]
  documents: Document[]
  match_total?: number
  overview?: Partial<Record<Sport, OverviewSummary>>
  match_history?: Match[]
}
export interface Source {
  id?: string
  source?: string
  uri?: string
  title?: string
}
export interface ToolEvidence {
  tool: string
  source?: string
  rows?: unknown[]
  status?: string
  error?: string
}
export interface ChatResponse {
  answer: string
  citations: Source[]
  tools?: ToolEvidence[]
  evidence?: ToolEvidence[]
  trace_id: string
  dataset_version: string
  data_kind: string
  as_of: string
  mode: string
  abstained: boolean
  model?: string | null
  metrics?: {
    latency_ms?: number
    latency_seconds?: number
    tool_calls?: number
    generated_tokens?: number
  }
}
export type Connection = 'local' | 'snapshot'
