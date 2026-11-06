import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './data'
import { instant } from './sports'

export interface OpenFootballManifest {
  research_version: 'openfootball-research-1.0' | 'openfootball-research-2.0'
  dataset_version: string
  as_of: string
  generated_at: string
  data_kind: 'open_data'
  provider: 'openfootball'
  license: 'CC0-1.0'
  canonical_compatible: false
  precision_note: string
  coverage_note: string
}
export interface OpenFootballMatch {
  match_id: string
  edition_id: string
  source_id: string
  competition_id: string
  competition: string
  season: string
  round: string | null
  team_a: string
  team_b: string
  team_a_id: string
  team_b_id: string
  source_date: string
  local_time: string | null
  kickoff_precision: 'date_only' | 'local_minute' | 'offset_minute'
  timezone: null
  start_time: string | null
  completed_at: null
  result_status: 'observed_result' | 'unknown_result'
  score_a: number | null
  score_b: number | null
  score_details_json: string | Record<string, unknown> | null
  score_basis: 'source_ft_unverified_regulation' | 'unknown'
  prediction_eligible: false
  observed_at: string
  revision: number
  event_id: string
  source_url: string
  source_ref: string | null
  source_sha256: string
  license: string
  license_url?: string
  team_identity_status: string
  availability_basis: string
  team_type?: 'club' | 'national'
  source_match_number?: number | null
  source_group?: string | null
  ground?: string | null
  utc_offset_minutes?: number | null
  team_namespace?: string
}
export interface OpenFootballEdition {
  edition_id: string
  competition_id: string
  name: string
  season: string
  region: string
  coverage_start: string | null
  coverage_end: string | null
  match_count: number
  observed_results: number
  unknown_results: number
  date_only: number
  local_minute: number
  offset_minute?: number
  team_type?: 'club' | 'national'
  participants: { team_id: string; team_name: string }[]
}
export interface OpenFootballSource {
  source_id: string
  competition_id: string
  season: string
  path: string
  name: string
  region: string
  team_namespace: string
  team_aliases: Record<string, string> | null
  source_ref: string | null
}
export interface OpenFootballSnapshot {
  manifest: OpenFootballManifest
  snapshot_fingerprint: string
  matches: OpenFootballMatch[]
  history: OpenFootballMatch[]
  competitions: OpenFootballEdition[]
  sources: OpenFootballSource[]
  quality: Record<string, unknown>
  lineage: unknown[]
  teams?: OpenFootballTeam[]
  team_profiles?: OpenFootballTeamProfile[]
  polls?: OpenFootballPoll[]
}
export interface OpenFootballPoll {
  poll_id: number
  source_id: string
  observed_at: string
  status: 'collected' | 'not_modified'
  sha256: string
  changed: number
  quarantined: number
}
export interface OpenFootballFilters {
  search: string
  region: string
  day: string
  status: 'all' | 'observed_result' | 'unknown_result'
  group: string
  round: string
}
export interface OpenFootballTeam {
  team_id: string
  team_name: string
  team_type: 'club' | 'national'
  region: string
  team_namespace: string
  record_count: number
  observed_results: number
  unknown_results: number
  edition_ids: string[]
  latest_source_date: string | null
}
export interface OpenFootballTeamProfile extends OpenFootballTeam {
  editions: {
    edition_id: string
    name: string
    season: string
    record_count: number
    observed_results: number
    unknown_results: number
  }[]
  recent_match_ids: string[]
  recent_match_limit: number
  coverage_note: string
}
export type OpenFootballConnection = 'local' | 'snapshot'

function validateSnapshot(value: unknown): OpenFootballSnapshot {
  const data = value as OpenFootballSnapshot
  if (
    !['openfootball-research-1.0', 'openfootball-research-2.0'].includes(
      data?.manifest?.research_version,
    ) ||
    data.manifest.provider !== 'openfootball' ||
    data.manifest.data_kind !== 'open_data' ||
    data.manifest.canonical_compatible !== false ||
    !data.manifest.dataset_version ||
    !Array.isArray(data.matches) ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.competitions) ||
    !Array.isArray(data.sources)
  )
    throw new Error('The OpenFootball research package does not match the supported contract.')
  for (const match of data.matches) {
    const explicitOffset = match.kickoff_precision === 'offset_minute'
    if (
      !match.match_id ||
      !match.edition_id ||
      !match.team_a ||
      !match.team_b ||
      !/^\d{4}-\d{2}-\d{2}$/.test(match.source_date) ||
      !['date_only', 'local_minute', 'offset_minute'].includes(match.kickoff_precision) ||
      !['observed_result', 'unknown_result'].includes(match.result_status) ||
      match.prediction_eligible !== false ||
      (explicitOffset
        ? data.manifest.research_version !== 'openfootball-research-2.0' ||
          !Number.isInteger(match.utc_offset_minutes) ||
          !match.local_time ||
          !match.start_time ||
          !Number.isFinite(Date.parse(match.start_time))
        : match.start_time !== null) ||
      match.timezone !== null ||
      (match.result_status === 'observed_result' &&
        (!Number.isInteger(match.score_a) || !Number.isInteger(match.score_b)))
    )
      throw new Error(
        'A source record has unsupported precision or result fields. Import a verified research package.',
      )
  }
  if (data.polls !== undefined) {
    const sources = new Set(data.sources.map((source) => source.source_id)),
      ids = new Set<number>()
    if (!Array.isArray(data.polls) || data.polls.length > 100000)
      throw new Error('Source collection evidence is invalid.')
    for (const poll of data.polls) {
      if (
        !poll ||
        typeof poll !== 'object' ||
        !Number.isInteger(poll.poll_id) ||
        poll.poll_id < 1 ||
        ids.has(poll.poll_id) ||
        !sources.has(poll.source_id) ||
        !['collected', 'not_modified'].includes(poll.status) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]00:00)$/.test(
          poll.observed_at,
        ) ||
        !Number.isFinite(Date.parse(poll.observed_at)) ||
        instant(poll.observed_at) > instant(data.manifest.as_of) ||
        !/^[a-f0-9]{64}$/.test(poll.sha256) ||
        !Number.isInteger(poll.changed) ||
        poll.changed < 0 ||
        poll.changed > 10000 ||
        !Number.isInteger(poll.quarantined) ||
        poll.quarantined < 0 ||
        poll.quarantined > 10000 ||
        (poll.status === 'not_modified' && (poll.changed !== 0 || poll.quarantined !== 0))
      )
        throw new Error(
          'Source collection evidence is invalid. Import a verified research package.',
        )
      ids.add(poll.poll_id)
    }
  }
  return data
}

export function editionCoverage(data: OpenFootballSnapshot, editionId: string) {
  const matches = data.matches.filter((match) => match.edition_id === editionId),
    polls = (data.polls || [])
      .filter((poll) => poll.source_id === editionId)
      .sort((a, b) => a.poll_id - b.poll_id),
    newest = <T>(rows: T[], timestamp: (row: T) => string) =>
      rows.reduce<T | undefined>(
        (latest, row) =>
          !latest || instant(timestamp(row)) >= instant(timestamp(latest)) ? row : latest,
        undefined,
      ),
    latestPoll = newest(polls, (poll) => poll.observed_at),
    latestMatch = newest(matches, (match) => match.observed_at),
    resultDates = matches
      .filter((match) => match.result_status === 'observed_result')
      .map((match) => match.source_date)
      .sort(),
    observed = matches.filter((match) => match.result_status === 'observed_result').length
  return {
    latestPoll,
    successfulChecks: polls.length,
    latestMatchObservedAt: latestMatch?.observed_at || null,
    latestResultDate: resultDates.at(-1) || null,
    records: matches.length,
    observed,
    unknown: matches.length - observed,
    dateOnly: matches.filter((match) => match.kickoff_precision === 'date_only').length,
    localMinute: matches.filter((match) => match.kickoff_precision === 'local_minute').length,
    offsetMinute: matches.filter((match) => match.kickoff_precision === 'offset_minute').length,
    source: data.sources.find((source) => source.source_id === editionId),
  }
}

export function collectionTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value))
}

async function loadStatic(): Promise<OpenFootballSnapshot> {
  const response = await fetch(`${import.meta.env.BASE_URL}open-football.json`, {
    cache: 'no-cache',
  })
  if (!response.ok) throw new Error('The published OpenFootball research package is unavailable.')
  return validateSnapshot(await response.json())
}

export function useOpenFootballData(enabled: boolean) {
  const [data, setData] = useState<OpenFootballSnapshot>(),
    [connection, setConnection] = useState<OpenFootballConnection>('snapshot'),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [transportNote, setTransportNote] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    setError('')
    setTransportNote('')
    try {
      let snapshot: OpenFootballSnapshot,
        mode: OpenFootballConnection = 'snapshot',
        note = ''
      if (import.meta.env.VITE_STATIC_DEMO === 'true') snapshot = await loadStatic()
      else {
        try {
          snapshot = validateSnapshot(await api('/open-football/snapshot', {}, 20000))
          mode = 'local'
        } catch {
          snapshot = await loadStatic()
          note =
            'Local OpenFootball transport is unavailable. Showing the published research package.'
        }
      }
      if (request === sequence.current) {
        setData(snapshot)
        setConnection(mode)
        setTransportNote(note)
      }
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : 'The source package could not be loaded.')
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (enabled && !data && !loading && !error && sequence.current === 0) void reload()
  }, [enabled, data, loading, error, reload])
  return { data, connection, loading, error, transportNote, reload }
}

// These are calendar labels, never normalized kickoff timestamps.
export function sourceDay(value: string | null) {
  if (!value) return 'Date unavailable'
  const [year, month, day] = value.split('-'),
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(day)} ${months[Number(month) - 1] || month} ${year}`
}
export function searchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
}
export function resultLabel(match: OpenFootballMatch) {
  return match.result_status === 'observed_result' ? 'Observed result' : 'Result unknown'
}
export function sourceClock(match: OpenFootballMatch) {
  return match.local_time
    ? `${match.local_time} · source local time; ${match.kickoff_precision === 'offset_minute' ? `explicit ${sourceOffset(match.utc_offset_minutes)}` : 'timezone unresolved'}`
    : 'Time unavailable'
}
export function sourceOffset(minutes: number | null | undefined) {
  if (typeof minutes !== 'number') return 'Offset unavailable'
  const total = Math.abs(minutes)
  return `UTC${minutes >= 0 ? '+' : '−'}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
export function resolvedUtc(match: OpenFootballMatch) {
  if (match.kickoff_precision !== 'offset_minute' || !match.start_time) return null
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(match.start_time))
}
export function sourceLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/openfootball/'))
      return url.href
    if (url.hostname === 'github.com' && url.pathname.startsWith('/openfootball/')) return url.href
    if (url.hostname === 'creativecommons.org' && url.pathname.startsWith('/publicdomain/zero/'))
      return url.href
  } catch {
    /* Unsupported external links are displayed as text. */
  }
  return undefined
}
export function parsedScore(match: OpenFootballMatch): Record<string, unknown> | null {
  if (!match.score_details_json) return null
  try {
    const parsed =
      typeof match.score_details_json === 'string'
        ? JSON.parse(match.score_details_json)
        : match.score_details_json
    return parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).some((key) => ['ft', 'ht', 'et', 'p'].includes(key))
      ? parsed
      : null
  } catch {
    return null
  }
}
