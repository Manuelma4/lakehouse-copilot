import { publishedLive } from './live'
import type { LiveHealth, LiveProvider } from './live'
import { instant } from './sports'

export type LiveChatMode = 'ollama' | 'evidence'
export interface LiveAsk {
  provider: LiveProvider
  match_id: string
  question: string
  mode: LiveChatMode
  snapshot_fingerprint?: string
}
export type LiveSource = 'gold/matches.parquet' | 'LIVE_STATUS.json'
export interface LiveCitation {
  id: string
  uri: string
  source: LiveSource
  provider: LiveProvider
  dataset_version: string
  snapshot_fingerprint: string
}
export interface LiveToolEvidence {
  tool: string
  source?: LiveSource
  citation_id?: string | null
  provider?: LiveProvider
  dataset_version?: string | null
  snapshot_fingerprint?: string | null
  cutoff?: string | null
  rows?: Record<string, unknown>[]
  error?: string
  result_known?: boolean
  score_unit?: 'goals' | 'maps'
  score_interpretation?: string
  history_basis?: string
  [field: string]: unknown
}
export interface LiveAnswer extends LiveHealth {
  answer: string
  citations: LiveCitation[]
  tool_results: LiveToolEvidence[]
  trace_id: string
  contract_version: string | null
  prompt_version: string
  mode: LiveChatMode
  model: string | null
  model_digest: string | null
  abstained: boolean
  metrics: { latency_seconds: number; generated_tokens: number; tool_calls: number }
  grounding: string
}

const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const sourceNames: LiveSource[] = ['gold/matches.parquet', 'LIVE_STATUS.json']
const toolNames = ['live_match', 'live_matches', 'live_team_form', 'live_quality']
const utc = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) &&
  Number.isFinite(Date.parse(value))
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const natural = (value: unknown) => Number.isInteger(value) && Number(value) >= 0
const foreign = (provider: LiveProvider, value: unknown) =>
  typeof value !== 'string' || !new RegExp(`^${provider}:[0-9]{1,20}$`).test(value)
const invalid = () =>
  new Error('The answer failed its captured-source contract. No unverified answer was displayed.')
const fingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export class LiveCaptureChangedError extends Error {
  constructor() {
    super('The selected publication changed. Refresh this validated record before asking again.')
    this.name = 'LiveCaptureChangedError'
  }
}

// Validate the response against its immutable capture and an optional pinned
// request fingerprint. A later board refresh cannot rewrite the request context.
// References prove provenance, not semantic correctness.
export function validateLiveAnswer(raw: unknown, request: LiveAsk): LiveAnswer {
  if (
    !object(raw) ||
    (request.snapshot_fingerprint !== undefined && !fingerprint(request.snapshot_fingerprint))
  )
    throw invalid()
  const answer = raw as unknown as LiveAnswer
  if (
    answer.provider !== request.provider ||
    answer.data_kind !== 'api' ||
    answer.mode !== request.mode ||
    ![
      'awaiting_credentials',
      'polling',
      'ready',
      'empty',
      'degraded',
      'quota_limited',
      'not_connected',
      'invalid_publication',
      'stale',
    ].includes(answer.status) ||
    typeof answer.snapshot_available !== 'boolean' ||
    typeof answer.stale !== 'boolean' ||
    typeof answer.serving_last_good !== 'boolean' ||
    answer.update_mode !== 'polled_rest' ||
    answer.in_game_round_feed !== false ||
    answer.predictions_available !== false ||
    [
      answer.generated_at,
      answer.last_attempt_at,
      answer.last_success_at,
      answer.last_change_at,
    ].some((value) => value !== null && !utc(value)) ||
    !text(answer.answer, 4000) ||
    !text(answer.prompt_version, 100) ||
    !text(answer.grounding, 1000) ||
    !/^[a-f0-9]{32}$/.test(answer.trace_id || '') ||
    typeof answer.abstained !== 'boolean' ||
    !Array.isArray(answer.citations) ||
    answer.citations.length > 6 ||
    !Array.isArray(answer.tool_results) ||
    !answer.tool_results.length ||
    answer.tool_results.length > 6 ||
    !object(answer.metrics) ||
    typeof answer.metrics.latency_seconds !== 'number' ||
    !Number.isFinite(answer.metrics.latency_seconds) ||
    answer.metrics.latency_seconds < 0 ||
    !natural(answer.metrics.generated_tokens) ||
    !natural(answer.metrics.tool_calls) ||
    answer.metrics.tool_calls < 1 ||
    answer.metrics.tool_calls > 6 ||
    answer.metrics.tool_calls < answer.tool_results.length ||
    (answer.model !== null && !text(answer.model, 100)) ||
    (answer.model_digest !== null && !text(answer.model_digest, 150)) ||
    (request.mode === 'evidence' &&
      (answer.model !== null ||
        answer.model_digest !== null ||
        answer.metrics.generated_tokens !== 0))
  )
    throw invalid()
  if (answer.snapshot_available) {
    if (
      !/^[a-f0-9]{16}$/.test(answer.dataset_version || '') ||
      !/^[a-f0-9]{64}$/.test(answer.snapshot_fingerprint || '') ||
      !utc(answer.cutoff) ||
      !utc(answer.as_of) ||
      instant(answer.cutoff) !== instant(answer.as_of) ||
      answer.contract_version !== '2.0'
    )
      throw invalid()
  } else if (
    answer.dataset_version !== null ||
    answer.snapshot_fingerprint !== null ||
    answer.cutoff !== null ||
    answer.as_of !== null ||
    answer.contract_version !== null ||
    !answer.abstained ||
    answer.citations.length
  )
    throw invalid()

  if (
    request.snapshot_fingerprint !== undefined &&
    answer.snapshot_fingerprint !== request.snapshot_fingerprint
  )
    throw new LiveCaptureChangedError()

  const cited = new Map<string, LiveToolEvidence>()
  let selectedMatch = false
  for (const tool of answer.tool_results) {
    if (!object(tool) || !text(tool.tool, 80)) throw invalid()
    if (tool.error !== undefined) {
      if (
        !text(tool.error, 1000) ||
        [
          'source',
          'citation_id',
          'provider',
          'dataset_version',
          'snapshot_fingerprint',
          'cutoff',
          'rows',
        ].some((field) => tool[field] !== undefined)
      )
        throw invalid()
      continue
    }
    if (
      !toolNames.includes(tool.tool) ||
      !sourceNames.includes(tool.source!) ||
      tool.source !==
        (tool.tool === 'live_quality' ? 'LIVE_STATUS.json' : 'gold/matches.parquet') ||
      tool.provider !== answer.provider ||
      tool.dataset_version !== answer.dataset_version ||
      tool.snapshot_fingerprint !== answer.snapshot_fingerprint ||
      (answer.cutoff === null
        ? tool.cutoff !== null
        : !utc(tool.cutoff) || instant(tool.cutoff) !== instant(answer.cutoff)) ||
      tool.citation_id !==
        (answer.snapshot_available
          ? `${answer.provider}:${answer.snapshot_fingerprint}:${tool.source}`
          : null) ||
      !Array.isArray(tool.rows) ||
      tool.rows.length > 5 ||
      tool.rows.some((row) => !object(row))
    )
      throw invalid()
    for (const row of tool.rows) {
      if (tool.tool === 'live_quality') {
        if (
          !object(row.health) ||
          row.health.provider !== answer.provider ||
          row.health.dataset_version !== answer.dataset_version ||
          row.health.snapshot_fingerprint !== answer.snapshot_fingerprint ||
          row.health.cutoff !== answer.cutoff
        )
          throw invalid()
      } else if (
        !answer.cutoff ||
        !utc(row.observed_at) ||
        instant(row.observed_at) > instant(answer.cutoff) ||
        foreign(answer.provider, row.match_id) ||
        !text(row.match_id, 120) ||
        (row.provider !== undefined && row.provider !== answer.provider) ||
        [row.team_a_id, row.team_b_id, row.team_id, row.opponent_id].some(
          (id) => id !== undefined && id !== null && foreign(answer.provider, id),
        )
      )
        throw invalid()
    }
    if (tool.tool === 'live_match') {
      const row = tool.rows[0]
      if (
        tool.rows.length !== 1 ||
        row.match_id !== request.match_id ||
        typeof tool.result_known !== 'boolean' ||
        tool.result_known !== (row.status === 'finished') ||
        tool.score_unit !== (answer.provider === 'football-data' ? 'goals' : 'maps') ||
        !text(tool.score_interpretation, 1000) ||
        !text(tool.history_basis, 1000)
      )
        throw invalid()
      selectedMatch = true
    }
    if (tool.citation_id) cited.set(tool.citation_id, tool)
  }
  const ids = new Set<string>()
  for (const citation of answer.citations) {
    if (
      !object(citation) ||
      !cited.has(citation.id) ||
      ids.has(citation.id) ||
      citation.provider !== answer.provider ||
      citation.dataset_version !== answer.dataset_version ||
      citation.snapshot_fingerprint !== answer.snapshot_fingerprint ||
      citation.source !== cited.get(citation.id)?.source ||
      citation.uri !==
        `snapshot://${answer.provider}/${answer.dataset_version}/${answer.snapshot_fingerprint}/${citation.source}`
    )
      throw invalid()
    ids.add(citation.id)
  }
  if (!answer.abstained && (!selectedMatch || !answer.citations.length)) throw invalid()
  return answer
}

async function post(path: string, body: unknown, signal: AbortSignal, timeoutMs: number) {
  if (publishedLive)
    throw new Error('Current-match AI and feedback are unavailable in this public site.')
  const timeout = new AbortController(),
    timer = window.setTimeout(() => timeout.abort(), timeoutMs)
  try {
    const response = await fetch(`${base}/live/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout.signal]),
      cache: 'no-store',
    })
    if (!response.ok) {
      if (response.status === 409 && path === 'chat') throw new LiveCaptureChangedError()
      const errors: Record<number, string> = {
        429: 'The local model is busy (429). Retry the selected mode when the current request finishes.',
        503: 'The current-match service or requested local model is unavailable (503).',
        504: 'The server reached its 180-second request deadline (504). Try a narrower question.',
        404: 'This captured trace is unavailable for feedback (404).',
        400: 'The provider context or question was rejected (400).',
        422: 'The provider context or question was rejected (422).',
      }
      throw new Error(
        errors[response.status] || `The current-match request failed (${response.status}).`,
      )
    }
    const content = await response.text()
    if (content.length > 200000) throw invalid()
    try {
      return JSON.parse(content) as unknown
    } catch {
      throw invalid()
    }
  } catch (error) {
    if (timeout.signal.aborted && !signal.aborted)
      throw new Error(
        `The browser stopped waiting after ${timeoutMs / 1000} seconds. Retry when the server is available.`,
      )
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function askLiveMatch(request: LiveAsk, signal: AbortSignal): Promise<LiveAnswer> {
  if (
    !['football-data', 'pandascore'].includes(request.provider) ||
    foreign(request.provider, request.match_id) ||
    !text(request.question, 2000) ||
    !['ollama', 'evidence'].includes(request.mode) ||
    (request.snapshot_fingerprint !== undefined && !fingerprint(request.snapshot_fingerprint))
  )
    throw new Error('Select a valid provider match and enter a question of up to 2,000 characters.')
  return validateLiveAnswer(await post('chat', request, signal, 200000), request)
}

export async function sendLiveFeedback(
  answer: LiveAnswer,
  rating: -1 | 1,
  comment: string,
  signal: AbortSignal,
) {
  const result = await post(
    'feedback',
    {
      provider: answer.provider,
      trace_id: answer.trace_id,
      rating,
      comment: comment.slice(0, 1000),
      ...(answer.snapshot_fingerprint ? { snapshot_fingerprint: answer.snapshot_fingerprint } : {}),
    },
    signal,
    15000,
  )
  if (
    !object(result) ||
    result.status !== 'saved' ||
    result.trace_id !== answer.trace_id ||
    (result.provider !== undefined && result.provider !== answer.provider)
  )
    throw new Error('Feedback acknowledgement did not match this captured trace.')
}
