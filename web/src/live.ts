import { useEffect, useRef, useState } from 'react'
import { instant } from './sports'

export type LiveProvider = 'football-data' | 'pandascore'
export type LiveMatchStatus = 'scheduled' | 'running' | 'finished' | 'cancelled' | 'postponed'
export type LiveFilterStatus = LiveMatchStatus | 'all'
export type LiveState =
  | 'awaiting_credentials'
  | 'polling'
  | 'ready'
  | 'empty'
  | 'degraded'
  | 'quota_limited'
  | 'not_connected'
  | 'invalid_publication'
  | 'stale'
export interface LiveMatch {
  event_id: string
  match_id: string
  provider: LiveProvider
  sport: 'football' | 'valorant'
  competition: string
  revision: number
  team_a_id: string
  team_a: string
  team_b_id: string
  team_b: string
  start_time: string
  observed_at: string
  completed_at: string | null
  status: LiveMatchStatus
  score_a: number | null
  score_b: number | null
  best_of: number
}
export interface LiveHealth {
  provider: LiveProvider
  data_kind: 'api'
  status: LiveState
  producer_status: string | null
  snapshot_available: boolean
  dataset_version: string | null
  snapshot_fingerprint: string | null
  as_of: string | null
  cutoff: string | null
  generated_at: string | null
  last_attempt_at: string | null
  last_success_at: string | null
  last_change_at: string | null
  poll_interval_seconds: number | null
  poll_age_seconds: number | null
  stale_after_seconds: number | null
  stale: boolean
  serving_last_good: boolean
  publication_error_code: string | null
  last_error_code: string | null
  poll_counts: {
    attempted: number
    succeeded: number
    failed: number
    awaiting_credentials: number
    quota_limited: number
    interrupted: number
  } | null
  last_poll: {
    source_rows: number
    changed_rows: number
    unsupported_rows: number
    requests: number
  } | null
  capabilities: {
    tier: 'free'
    update_mode: 'polled_rest'
    scores_delayed: boolean | null
    fixtures_and_results: true
    in_game_round_feed: false
  } | null
  request_budget: { limit: number; window_seconds: number; used: number; remaining: number } | null
  source_scope?: {
    kind: 'competition_list' | 'match_phases'
    competition_codes: string[]
    phases: string[]
    pages: number
  } | null
  freshness_scope?: 'declared_poll_scope' | 'unknown_poll_scope'
  coverage_scope?: string
  update_mode: 'polled_rest'
  in_game_round_feed: false
  predictions_available: false
}
export interface LivePage extends LiveHealth {
  rows: LiveMatch[]
  total: number
  limit: number
  offset: number
}
export interface LiveDetail extends LiveHealth {
  match: LiveMatch | null
}
export interface LiveFilters {
  status: LiveFilterStatus
  search: string
  page: number
  tab?: 'matches' | 'events'
  event?: string
  from?: string
  through?: string
  includeUnresolved?: boolean
  workspace?: 'directory' | 'canonical'
}
export const liveProviders = {
  'football-data': { name: 'football-data', sport: 'football', label: 'Football', unit: 'goals' },
  pandascore: { name: 'PandaScore', sport: 'valorant', label: 'VALORANT', unit: 'series maps' },
} as const
export const publishedLive = import.meta.env.VITE_STATIC_DEMO === 'true'
const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const states: LiveState[] = [
  'awaiting_credentials',
  'polling',
  'ready',
  'empty',
  'degraded',
  'quota_limited',
  'not_connected',
  'invalid_publication',
  'stale',
]
const matchStates: LiveMatchStatus[] = [
  'scheduled',
  'running',
  'finished',
  'cancelled',
  'postponed',
]
const isUtc = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) &&
  Number.isFinite(Date.parse(value))
const nonnegative = (value: unknown) => Number.isInteger(value) && Number(value) >= 0

function health(value: unknown, provider: LiveProvider): LiveHealth {
  const row = value as LiveHealth
  if (
    !row ||
    row.provider !== provider ||
    row.data_kind !== 'api' ||
    !states.includes(row.status) ||
    typeof row.snapshot_available !== 'boolean' ||
    typeof row.stale !== 'boolean' ||
    typeof row.serving_last_good !== 'boolean' ||
    row.update_mode !== 'polled_rest' ||
    row.in_game_round_feed !== false ||
    row.predictions_available !== false ||
    [
      row.last_attempt_at,
      row.last_success_at,
      row.last_change_at,
      row.as_of,
      row.cutoff,
      row.generated_at,
    ].some((stamp) => stamp !== null && !isUtc(stamp)) ||
    (row.snapshot_available &&
      (!/^[a-f0-9]{16}$/.test(row.dataset_version || '') ||
        !/^[a-f0-9]{64}$/.test(row.snapshot_fingerprint || '') ||
        !row.as_of ||
        row.cutoff !== row.as_of)) ||
    (!row.snapshot_available &&
      (row.dataset_version !== null ||
        row.snapshot_fingerprint !== null ||
        row.as_of !== null ||
        row.cutoff !== null)) ||
    (row.capabilities &&
      (row.capabilities.tier !== 'free' ||
        row.capabilities.update_mode !== 'polled_rest' ||
        row.capabilities.fixtures_and_results !== true ||
        row.capabilities.in_game_round_feed !== false ||
        row.capabilities.scores_delayed !== (provider === 'football-data' ? true : null)))
  )
    throw new Error(
      'The current-data response failed its provider contract. No new publication was displayed.',
    )
  if (
    row.source_scope &&
    (!['competition_list', 'match_phases'].includes(row.source_scope.kind) ||
      !Array.isArray(row.source_scope.competition_codes) ||
      !Array.isArray(row.source_scope.phases) ||
      !Number.isInteger(row.source_scope.pages) ||
      row.source_scope.pages < 1 ||
      row.source_scope.pages > 100 ||
      [...row.source_scope.competition_codes, ...row.source_scope.phases].some(
        (item) => typeof item !== 'string' || !/^[a-zA-Z0-9_-]{1,30}$/.test(item),
      ))
  )
    throw new Error('The latest provider check has invalid scope metadata.')
  if (
    row.coverage_scope !== undefined &&
    (typeof row.coverage_scope !== 'string' || row.coverage_scope.length > 1000)
  )
    throw new Error('The provider coverage description is invalid.')
  return row
}
function match(value: unknown, provider: LiveProvider, cutoff: string): LiveMatch {
  const row = value as LiveMatch
  if (
    !row ||
    row.provider !== provider ||
    row.sport !== liveProviders[provider].sport ||
    !row.match_id ||
    !row.event_id ||
    !row.team_a_id ||
    !row.team_b_id ||
    row.team_a_id === row.team_b_id ||
    !row.team_a ||
    !row.team_b ||
    !row.competition ||
    !matchStates.includes(row.status) ||
    !isUtc(row.start_time) ||
    !isUtc(row.observed_at) ||
    instant(row.observed_at) > instant(cutoff) ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    !Number.isInteger(row.best_of) ||
    row.best_of < 1 ||
    row.best_of > 9 ||
    [row.score_a, row.score_b].some(
      (score) => score !== null && (!nonnegative(score) || Number(score) > 50),
    ) ||
    (row.status === 'finished'
      ? !isUtc(row.completed_at) ||
        row.score_a === null ||
        row.score_b === null ||
        instant(row.start_time) >= instant(row.completed_at) ||
        instant(row.completed_at) > instant(row.observed_at)
      : row.completed_at !== null)
  )
    throw new Error(
      'A current match failed its provider contract. No new publication was displayed.',
    )
  if (
    row.status === 'finished' &&
    provider === 'pandascore' &&
    (row.best_of % 2 === 0 ||
      Math.max(row.score_a!, row.score_b!) !== Math.floor(row.best_of / 2) + 1 ||
      Math.min(row.score_a!, row.score_b!) >= Math.floor(row.best_of / 2) + 1)
  )
    throw new Error('An unsupported completed series result was rejected.')
  return row
}
function consistent(first: LiveHealth, second: LiveHealth) {
  return (
    first.provider === second.provider &&
    first.dataset_version === second.dataset_version &&
    first.snapshot_fingerprint === second.snapshot_fingerprint &&
    first.cutoff === second.cutoff
  )
}
async function request(path: string, signal: AbortSignal) {
  if (publishedLive) throw new Error('Live connection unavailable in this published site.')
  const timeout = new AbortController(),
    timer = window.setTimeout(() => timeout.abort(), 12000)
  try {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.any([signal, timeout.signal]),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`The live backend request failed (${response.status}).`)
    return await response.json()
  } finally {
    window.clearTimeout(timer)
  }
}

export function useLiveMatches(provider: LiveProvider, filters: LiveFilters, refresh: number) {
  const [state, setState] = useState<{
    key: string
    page?: LivePage
    error: string
    loading: boolean
  }>({ key: '', error: '', loading: false })
  const sequence = useRef(0),
    key = JSON.stringify([provider, filters.status, filters.search, filters.page])
  useEffect(() => {
    if (publishedLive) return
    const generation = ++sequence.current,
      controller = new AbortController()
    let timer: number | undefined
    async function load() {
      setState((old) => ({
        key,
        page: old.key === key ? old.page : undefined,
        error: old.key === key ? old.error : '',
        loading: true,
      }))
      try {
        const query = new URLSearchParams({
          provider,
          limit: '25',
          offset: String(filters.page * 25),
          order: filters.status === 'scheduled' ? 'asc' : 'desc',
        })
        if (filters.status !== 'all') query.set('status', filters.status)
        if (filters.search.trim()) query.set('search', filters.search.trim().slice(0, 100))
        const [rawHealth, rawPage] = await Promise.all([
          request(`/live/health?provider=${provider}`, controller.signal),
          request(`/live/matches?${query}`, controller.signal),
        ])
        const status = health(rawHealth, provider),
          page = health(rawPage, provider) as LivePage
        if (!consistent(status, page))
          throw new Error(
            'The publication changed during this check. Waiting for a consistent version.',
          )
        if (
          !Array.isArray(page.rows) ||
          page.rows.length > 25 ||
          !nonnegative(page.total) ||
          page.total > 100000 ||
          page.limit !== 25 ||
          page.offset !== filters.page * 25 ||
          page.rows.length > page.total ||
          (!page.snapshot_available && page.rows.length) ||
          (page.status === 'invalid_publication' && !page.serving_last_good && page.rows.length)
        )
          throw new Error(
            'The current-data page failed its bounded contract. No new publication was displayed.',
          )
        page.rows.forEach((row) => match(row, provider, page.cutoff!))
        if (new Set(page.rows.map((row) => row.match_id)).size !== page.rows.length)
          throw new Error('Duplicate current match identities were rejected.')
        if (generation === sequence.current && !controller.signal.aborted)
          setState({ key, page, error: '', loading: false })
      } catch (error) {
        if (generation === sequence.current && !controller.signal.aborted)
          setState((old) => ({
            key,
            page: old.key === key ? old.page : undefined,
            error: error instanceof Error ? error.message : 'The live backend is unavailable.',
            loading: false,
          }))
      } finally {
        if (generation === sequence.current && !controller.signal.aborted)
          timer = window.setTimeout(load, 8000)
      }
    }
    void load()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [provider, key, refresh])
  return {
    page: state.key === key ? state.page : undefined,
    error: state.key === key ? state.error : '',
    loading: state.key !== key || state.loading,
  }
}

export function useLiveDetail(
  provider: LiveProvider,
  id: string,
  page: LivePage | undefined,
  expectedFingerprint = '',
) {
  const [state, setState] = useState<{ key: string; detail?: LiveDetail; error: string }>({
    key: '',
    error: '',
  })
  const key = JSON.stringify([provider, id, page?.snapshot_fingerprint, expectedFingerprint]),
    changed = !!expectedFingerprint && !!page && page.snapshot_fingerprint !== expectedFingerprint
  useEffect(() => {
    if (
      !id ||
      !page?.snapshot_available ||
      changed ||
      publishedLive ||
      page.rows.some((row) => row.match_id === id)
    )
      return
    const controller = new AbortController()
    request(`/live/matches/${encodeURIComponent(id)}?provider=${provider}`, controller.signal)
      .then((raw) => {
        const detail = health(raw, provider) as LiveDetail
        if (
          !consistent(page, detail) ||
          (expectedFingerprint && detail.snapshot_fingerprint !== expectedFingerprint)
        )
          throw new Error(
            'This match belongs to a different publication. Waiting for the next consistent refresh.',
          )
        if (!detail.match)
          throw new Error('This match is not available in the verified publication.')
        match(detail.match, provider, detail.cutoff!)
        if (!controller.signal.aborted) setState({ key, detail, error: '' })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((old) => ({
            key,
            detail: old.key === key ? old.detail : undefined,
            error: error instanceof Error ? error.message : 'The current match is unavailable.',
          }))
      })
    return () => controller.abort()
  }, [provider, id, key, page, changed, expectedFingerprint])
  const direct = page?.rows.find((row) => row.match_id === id)
  return {
    match: changed ? undefined : direct || (state.key === key ? state.detail?.match : undefined),
    error: changed
      ? 'The validated record publication changed. Return to current announcements and refresh before inspecting or asking about this record.'
      : direct
        ? ''
        : page && !page.snapshot_available
          ? 'No verified provider publication is available for this match.'
          : state.key === key
            ? state.error
            : '',
    loading: !changed && !direct && state.key !== key,
  }
}
