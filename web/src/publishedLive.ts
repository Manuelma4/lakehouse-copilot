import { useEffect, useRef, useState } from 'react'
import type { LiveFilters, LiveProvider } from './live'
import { instant } from './sports'

export const publishedCurrentEnabled =
  import.meta.env.VITE_STATIC_DEMO === 'true' &&
  import.meta.env.VITE_PUBLISHED_CURRENT_DATA === 'true'
const schema = 'arena-live-display-1.0'
const schemaV2 = 'arena-live-display-2.0'
const providers: LiveProvider[] = ['football-data', 'pandascore']
const credits = {
  'football-data': {
    text: 'Football data provided by the Football-Data.org API',
    url: 'https://www.football-data.org/',
    terms_url: 'https://www.football-data.org/client/register',
  },
  pandascore: {
    text: 'Source: PandaScore',
    url: 'https://www.pandascore.co/',
    terms_url: 'https://www.pandascore.co/terms-and-condition',
  },
}
const licenseNote =
  "Provider-derived processed cards for the account owner's informational website; not MIT, CC0, or a reusable provider data feed."
export interface DisplayCardV1 {
  display_id: string
  sport: 'football' | 'valorant'
  competition_label: string
  team_a: { display_id: string; label: string }
  team_b: { display_id: string; label: string }
  kickoff_utc: string
  day_utc: string
  kickoff_label: string
  status_label: 'Scheduled' | 'In progress' | 'Finished' | 'Cancelled' | 'Postponed'
  series_format: string
  score_label: string | null
  result_state: 'unavailable' | 'provisional' | 'final'
  winning_side: 'team_a' | 'team_b' | 'draw' | null
}
interface DisplayScope {
  kind: 'competition_list' | 'match_phases'
  competition_codes: string[]
  phases: string[]
  pages: number
}
export interface ProviderDisplayV1 {
  schema_version: typeof schema
  data_kind: 'processed_api_display'
  provider: LiveProvider
  facts_version: string
  canonical: null | {
    dataset_version: string
    snapshot_fingerprint: string
    cutoff: string
    generated_at: string
  }
  health: {
    state: string
    producer_state: string | null
    stale: boolean
    serving_last_good: boolean
    last_attempt_at: string | null
    last_success_at: string | null
    last_change_at: string | null
    poll_interval_seconds: number | null
    stale_after_seconds: number | null
    source_scope: DisplayScope | null
    attempt_scope: DisplayScope | null
    freshness_scope: 'declared_poll_scope' | 'unknown_poll_scope'
    error_code: string | null
    scores_delayed: boolean | null
    update_mode: 'polled_rest'
    in_game_round_feed: false
  }
  coverage: {
    retained_total: number
    window_total: number
    displayed: number
    clipped: number
    outside_window: number
    running_outside_window: number
    unsupported_last_poll: number | null
    card_limit: number
    window_from: string
    window_through: string
    window_day_utc: string
    note: string
  }
  attribution: { text: string; url: string; terms_url: string }
  license_note: string
  cards: DisplayCardV1[]
}
export interface DirectoryNode {
  display_id: string
  kind: 'competition' | 'league' | 'series' | 'tournament'
  parent_id: string | null
  label: string
  name: string | null
  full_name: string | null
  season: string | null
  year: number | null
  identity_basis: 'source_identity' | 'observed_label' | 'unresolved_metadata'
  metadata_conflicted: boolean
  parent_conflicted: boolean
}
export interface DisplayCard extends Omit<
  DisplayCardV1,
  | 'team_a'
  | 'team_b'
  | 'kickoff_utc'
  | 'day_utc'
  | 'kickoff_label'
  | 'status_label'
  | 'series_format'
  | 'result_state'
> {
  team_a: DisplayCardV1['team_a'] | null
  team_b: DisplayCardV1['team_b'] | null
  kickoff_utc: string | null
  day_utc: string | null
  kickoff_label: string | null
  status_label: DisplayCardV1['status_label'] | 'Unknown'
  series_format: string | null
  result_state: DisplayCardV1['result_state'] | 'source_reported'
  event_node_ids: string[]
  announcement_label: string | null
  kickoff_precision: 'utc' | 'source_date' | 'timezone_unknown' | 'unknown'
  kickoff_source_text: string | null
  resolution: 'validated' | 'pending' | 'conflicted' | 'legacy'
  pending_reasons: string[]
  association_state:
    'none' | 'associated_historical' | 'matches_latest_announcement' | 'canonical_record'
}
export interface ProviderDisplayV2 extends Omit<
  ProviderDisplayV1,
  'schema_version' | 'cards' | 'coverage'
> {
  schema_version: typeof schemaV2
  calendar: null | {
    dataset_version: string
    calendar_fingerprint: string
    facts_version: string
    cutoff: string
    generated_at: string
  }
  publication: null | { fingerprint: string; collected_at: string; selected_at: string }
  directory_status: 'observed' | 'not_supplied'
  directory_nodes: DirectoryNode[]
  coverage: ProviderDisplayV1['coverage'] & {
    unknown_utc_total: number
    eligible_total: number
    eligible_undated_total: number
    pending_total: number
    pending_displayed: number
    directory_nodes_displayed: number
  }
  cards: DisplayCard[]
}
export type ProviderDisplay = ProviderDisplayV1 | ProviderDisplayV2
// Rendering adaptation happens only after wire validation. Null marks metadata
// that a legacy body did not supply; accepted wire objects stay unchanged.
export interface DisplayView extends Omit<ProviderDisplayV2, 'schema_version' | 'coverage'> {
  schema_version: ProviderDisplay['schema_version']
  coverage: ProviderDisplayV1['coverage'] & {
    unknown_utc_total: number | null
    eligible_total: number
    eligible_undated_total: number | null
    pending_total: number | null
    pending_displayed: number | null
    directory_nodes_displayed: number | null
  }
}
export function displayView(data: ProviderDisplay): DisplayView {
  if (data.schema_version === schemaV2) {
    if (
      data.directory_status !== 'not_supplied' ||
      data.calendar ||
      data.publication ||
      data.cards.some((card) => card.resolution !== 'legacy')
    )
      return data
    return {
      ...data,
      coverage: {
        ...data.coverage,
        unknown_utc_total: null,
        eligible_undated_total: null,
        pending_total: null,
        pending_displayed: null,
        directory_nodes_displayed: null,
      },
    }
  }
  return {
    ...data,
    calendar: null,
    publication: null,
    directory_status: 'not_supplied',
    directory_nodes: [],
    coverage: {
      ...data.coverage,
      eligible_total: data.coverage.window_total,
      unknown_utc_total: null,
      eligible_undated_total: null,
      pending_total: null,
      pending_displayed: null,
      directory_nodes_displayed: null,
    },
    cards: data.cards.map((card) => ({
      ...card,
      event_node_ids: [],
      announcement_label: null,
      kickoff_precision: 'utc',
      kickoff_source_text: null,
      resolution: 'legacy',
      pending_reasons: [],
      association_state: 'canonical_record',
    })),
  }
}
export interface DisplayManifest {
  schema_version: typeof schema | typeof schemaV2
  data_kind: 'processed_api_display'
  display_version: string
  package_fingerprint: string
  generated_at: string
  window_day_utc: string
  providers: LiveProvider[]
  facts_versions: Record<LiveProvider, string>
  files: Record<'football-data.json' | 'pandascore.json', string>
  processing_note: string
}
export interface DisplayPackage {
  manifest: DisplayManifest
  providers: Record<LiveProvider, ProviderDisplay>
  canonical_links?: Record<LiveProvider, Record<string, CanonicalLink>>
}
export interface CanonicalLink {
  match_id: string
  snapshot_fingerprint: string
}
const fail = (
  message = 'The published current-data package failed verification. No unverified cards were displayed.',
) => new Error(message)
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function keys(value: unknown, expected: string[]) {
  if (!record(value) || Object.keys(value).sort().join('|') !== [...expected].sort().join('|'))
    throw fail()
}
const hex = (value: unknown, size: number) =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(value)
const integer = (value: unknown, max = 100000, min = 0) =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max
const label = (value: unknown, max = 120) =>
  typeof value === 'string' &&
  Array.from(value).length >= 1 &&
  Array.from(value).length <= max &&
  !/[\x00-\x1f\x7f]/.test(value)
function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  )
}
function calendarDay(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
const shiftedDay = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
export function canonicalDisplayJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDisplayJSON).join(',')}]`
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalDisplayJSON(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
const encoder = new TextEncoder()
async function sha(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
const hash = (value: unknown) => sha(encoder.encode(canonicalDisplayJSON(value)))

// Bounded JSON parser rejects duplicate keys and non-finite numbers before any
// schema or checksum-normalization step. It does not evaluate source text.
function parseJSON(text: string): unknown {
  let at = 0
  const space = () => {
    while (/[\x20\t\r\n]/.test(text[at] || '') && at < text.length) at++
  }
  function string() {
    const begin = at++
    while (at < text.length) {
      if (text[at] === '\\') {
        at += 2
        continue
      }
      if (text[at++] === '"') return JSON.parse(text.slice(begin, at)) as string
    }
    throw fail()
  }
  function value(depth: number): unknown {
    if (depth > 20) throw fail()
    space()
    if (text[at] === '"') return string()
    if (text[at] === '{') {
      at++
      space()
      const result: Record<string, unknown> = Object.create(null),
        seen = new Set<string>()
      if (text[at] === '}') {
        at++
        return result
      }
      while (at < text.length) {
        space()
        if (text[at] !== '"') throw fail()
        const key = string()
        if (seen.has(key)) throw fail()
        seen.add(key)
        space()
        if (text[at++] !== ':') throw fail()
        result[key] = value(depth + 1)
        space()
        const end = text[at++]
        if (end === '}') return result
        if (end !== ',') throw fail()
      }
    }
    if (text[at] === '[') {
      at++
      space()
      const result: unknown[] = []
      if (text[at] === ']') {
        at++
        return result
      }
      while (at < text.length) {
        result.push(value(depth + 1))
        space()
        const end = text[at++]
        if (end === ']') return result
        if (end !== ',') throw fail()
      }
    }
    const token = text.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*))/)?.[0]
    if (!token) throw fail()
    at += token.length
    const parsed = JSON.parse(token) as unknown
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) throw fail()
    return parsed
  }
  try {
    const parsed = value(0)
    space()
    if (at !== text.length) throw fail()
    return parsed
  } catch {
    throw fail()
  }
}

function validateManifest(raw: unknown, now: number): DisplayManifest {
  keys(raw, [
    'schema_version',
    'data_kind',
    'display_version',
    'package_fingerprint',
    'generated_at',
    'window_day_utc',
    'providers',
    'facts_versions',
    'files',
    'processing_note',
  ])
  const manifest = raw as unknown as DisplayManifest
  keys(manifest.files, ['football-data.json', 'pandascore.json'])
  keys(manifest.facts_versions, providers)
  if (
    ![schema, schemaV2].includes(manifest.schema_version) ||
    manifest.data_kind !== 'processed_api_display' ||
    !hex(manifest.display_version, 16) ||
    !hex(manifest.package_fingerprint, 64) ||
    !utc(manifest.generated_at) ||
    instant(manifest.generated_at) > BigInt(now) * 1000n ||
    manifest.window_day_utc !== manifest.generated_at.slice(0, 10) ||
    JSON.stringify(manifest.providers) !== JSON.stringify(providers) ||
    !label(manifest.processing_note, 1000) ||
    Object.values(manifest.files).some((item) => !hex(item, 64)) ||
    Object.values(manifest.facts_versions).some((item) => !hex(item, 16))
  )
    throw fail()
  return manifest
}
function scope(raw: unknown, provider: LiveProvider) {
  if (raw === null) return
  keys(raw, ['kind', 'competition_codes', 'phases', 'pages'])
  const item = raw as DisplayScope
  if (
    !Array.isArray(item.competition_codes) ||
    !Array.isArray(item.phases) ||
    !integer(item.pages, 20, 1) ||
    item.competition_codes.length > 10 ||
    item.phases.length > 3 ||
    item.competition_codes.some(
      (code) => typeof code !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(code),
    ) ||
    item.phases.some((phase) => !['past', 'upcoming', 'running'].includes(phase)) ||
    new Set(item.competition_codes).size !== item.competition_codes.length ||
    new Set(item.phases).size !== item.phases.length ||
    (provider === 'football-data'
      ? item.kind !== 'competition_list' || !item.competition_codes.length || item.phases.length
      : item.kind !== 'match_phases' || item.competition_codes.length || !item.phases.length)
  )
    throw fail()
}
const states = [
  'not_connected',
  'invalid_publication',
  'awaiting_credentials',
  'polling',
  'ready',
  'empty',
  'degraded',
  'quota_limited',
  'stale',
]
const errors = [
  'awaiting_credentials',
  'quota_exhausted',
  'authentication_denied',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_http_error',
  'network_error',
  'network_timeout',
  'invalid_provider_payload',
  'ingest_failed',
  'publication_failed',
  'cursor_commit_failed',
  'worker_interrupted',
  'clock_regression',
  'invalid_endpoint',
  'worker_error',
  'invalid_publication',
  'status_missing',
  'snapshot_missing',
  'invalid_json',
  'unsafe_path',
  'size_limit',
  'snapshot_provider_mismatch',
  'snapshot_version_mismatch',
  'future_timestamp',
  'snapshot_inventory_mismatch',
  'snapshot_checksum_mismatch',
  'snapshot_provider_or_cutoff_mismatch',
  'duplicate_match_identity',
  'status_provider_mismatch',
]
function sortCards(a: DisplayCardV1, b: DisplayCardV1) {
  const rank = (card: DisplayCardV1) =>
    card.status_label === 'In progress' ? 0 : card.status_label === 'Scheduled' ? 1 : 2
  const compared = rank(a) - rank(b)
  if (compared) return compared
  const time = instant(a.kickoff_utc) - instant(b.kickoff_utc)
  return time !== 0n
    ? (time > 0n ? 1 : -1) * (rank(a) === 2 ? -1 : 1)
    : a.display_id < b.display_id
      ? -1
      : a.display_id > b.display_id
        ? 1
        : 0
}
async function validateProviderV1(
  raw: unknown,
  provider: LiveProvider,
  manifest: DisplayManifest,
): Promise<ProviderDisplayV1> {
  keys(raw, [
    'schema_version',
    'data_kind',
    'provider',
    'facts_version',
    'canonical',
    'health',
    'coverage',
    'attribution',
    'license_note',
    'cards',
  ])
  const data = raw as unknown as ProviderDisplayV1,
    { health, coverage, canonical } = data
  keys(health, [
    'state',
    'producer_state',
    'stale',
    'serving_last_good',
    'last_attempt_at',
    'last_success_at',
    'last_change_at',
    'poll_interval_seconds',
    'stale_after_seconds',
    'source_scope',
    'attempt_scope',
    'freshness_scope',
    'error_code',
    'scores_delayed',
    'update_mode',
    'in_game_round_feed',
  ])
  keys(coverage, [
    'retained_total',
    'window_total',
    'displayed',
    'clipped',
    'outside_window',
    'running_outside_window',
    'unsupported_last_poll',
    'card_limit',
    'window_from',
    'window_through',
    'window_day_utc',
    'note',
  ])
  keys(data.attribution, ['text', 'url', 'terms_url'])
  if (
    data.schema_version !== schema ||
    data.data_kind !== 'processed_api_display' ||
    data.provider !== provider ||
    !hex(data.facts_version, 16) ||
    data.facts_version !== manifest.facts_versions[provider] ||
    canonicalDisplayJSON(data.attribution) !== canonicalDisplayJSON(credits[provider]) ||
    data.license_note !== licenseNote ||
    !Array.isArray(data.cards) ||
    data.cards.length > 500 ||
    !states.includes(health.state) ||
    (health.producer_state !== null && !states.slice(2, 8).includes(health.producer_state)) ||
    typeof health.stale !== 'boolean' ||
    typeof health.serving_last_good !== 'boolean' ||
    health.scores_delayed !== (provider === 'football-data' ? true : null) ||
    health.update_mode !== 'polled_rest' ||
    health.in_game_round_feed !== false ||
    (health.error_code !== null && !errors.includes(health.error_code))
  )
    throw fail()
  for (const clock of [health.last_attempt_at, health.last_success_at, health.last_change_at])
    if (clock !== null && (!utc(clock) || instant(clock) > instant(manifest.generated_at)))
      throw fail()
  if (
    health.last_change_at &&
    (!health.last_success_at || instant(health.last_change_at) > instant(health.last_success_at))
  )
    throw fail()
  if (health.poll_interval_seconds !== null && !integer(health.poll_interval_seconds, 86400, 30))
    throw fail()
  const threshold =
    health.poll_interval_seconds === null ? null : Math.max(120, 2 * health.poll_interval_seconds)
  const age = health.last_success_at
    ? Number(instant(manifest.generated_at) - instant(health.last_success_at)) / 1e6
    : null
  const stale =
    age === null ||
    threshold === null ||
    age > threshold ||
    ['invalid_publication', 'not_connected'].includes(health.state) ||
    health.serving_last_good
  if (
    health.stale_after_seconds !== threshold ||
    health.stale !== stale ||
    (age !== null && threshold === null) ||
    (['ready', 'stale', 'empty'].includes(health.state) && !health.last_success_at) ||
    (health.state === 'ready' && stale) ||
    (health.state === 'stale' && !stale)
  )
    throw fail()
  scope(health.source_scope, provider)
  scope(health.attempt_scope, provider)
  if (
    health.freshness_scope !== (health.source_scope ? 'declared_poll_scope' : 'unknown_poll_scope')
  )
    throw fail()
  if (canonical !== null) {
    keys(canonical, ['dataset_version', 'snapshot_fingerprint', 'cutoff', 'generated_at'])
    if (
      !hex(canonical.dataset_version, 16) ||
      !hex(canonical.snapshot_fingerprint, 64) ||
      !utc(canonical.cutoff) ||
      !utc(canonical.generated_at) ||
      instant(canonical.cutoff) > instant(canonical.generated_at) ||
      instant(canonical.generated_at) > instant(manifest.generated_at) ||
      (health.last_success_at && instant(canonical.cutoff) > instant(health.last_success_at))
    )
      throw fail()
  } else if (
    data.cards.length ||
    coverage.retained_total ||
    health.serving_last_good ||
    health.state === 'ready'
  )
    throw fail()
  if (
    !calendarDay(coverage.window_day_utc) ||
    coverage.window_day_utc > manifest.window_day_utc ||
    (coverage.window_day_utc !== manifest.window_day_utc && !health.serving_last_good) ||
    coverage.window_from !== shiftedDay(coverage.window_day_utc, -14) ||
    coverage.window_through !== shiftedDay(coverage.window_day_utc, 30) ||
    !label(coverage.note, 2000) ||
    !integer(coverage.card_limit, 500, 1) ||
    ![
      'retained_total',
      'window_total',
      'displayed',
      'clipped',
      'outside_window',
      'running_outside_window',
    ].every((name) => integer(coverage[name as keyof typeof coverage])) ||
    (coverage.unsupported_last_poll !== null &&
      !integer(coverage.unsupported_last_poll, 1000000)) ||
    coverage.displayed !== data.cards.length ||
    coverage.displayed > coverage.card_limit ||
    coverage.window_total !== coverage.displayed + coverage.clipped ||
    coverage.retained_total !== coverage.window_total + coverage.outside_window ||
    coverage.running_outside_window > coverage.window_total
  )
    throw fail()
  const seen = new Set<string>(),
    validID = (id: unknown) =>
      typeof id === 'string' && new RegExp(`^${provider}-[0-9a-f]{16}$`).test(id)
  for (const card of data.cards) {
    keys(card, [
      'display_id',
      'sport',
      'competition_label',
      'team_a',
      'team_b',
      'kickoff_utc',
      'day_utc',
      'kickoff_label',
      'status_label',
      'series_format',
      'score_label',
      'result_state',
      'winning_side',
    ])
    keys(card.team_a, ['display_id', 'label'])
    keys(card.team_b, ['display_id', 'label'])
    if (
      !validID(card.display_id) ||
      !validID(card.team_a.display_id) ||
      !validID(card.team_b.display_id) ||
      seen.has(card.display_id) ||
      card.team_a.display_id === card.team_b.display_id ||
      card.sport !== (provider === 'football-data' ? 'football' : 'valorant') ||
      !label(card.competition_label) ||
      !label(card.team_a.label) ||
      !label(card.team_b.label) ||
      !utc(card.kickoff_utc) ||
      card.day_utc !== card.kickoff_utc.slice(0, 10) ||
      card.kickoff_label !== `${card.kickoff_utc.slice(11, 16)} UTC` ||
      !['Scheduled', 'In progress', 'Finished', 'Cancelled', 'Postponed'].includes(
        card.status_label,
      ) ||
      typeof card.series_format !== 'string' ||
      (provider === 'football-data'
        ? card.series_format !== 'Single match'
        : !/^Best of [1-9]$/.test(card.series_format)) ||
      ((card.day_utc < coverage.window_from || card.day_utc > coverage.window_through) &&
        card.status_label !== 'In progress')
    )
      throw fail()
    seen.add(card.display_id)
    if (card.score_label === null) {
      if (
        card.result_state !== 'unavailable' ||
        card.winning_side !== null ||
        card.status_label === 'Finished'
      )
        throw fail()
    } else {
      if (
        typeof card.score_label !== 'string' ||
        !/^(?:[0-9]|[1-4][0-9]|50)–(?:[0-9]|[1-4][0-9]|50)$/.test(card.score_label) ||
        !['Finished', 'In progress'].includes(card.status_label) ||
        instant(card.kickoff_utc) > instant(manifest.generated_at)
      )
        throw fail()
      const [a, b] = card.score_label.split('–').map(Number),
        final = card.status_label === 'Finished'
      if (
        card.result_state !== (final ? 'final' : 'provisional') ||
        card.winning_side !== (final ? (a > b ? 'team_a' : b > a ? 'team_b' : 'draw') : null)
      )
        throw fail()
      if (final && provider === 'pandascore') {
        const bo = Number(card.series_format.at(-1)),
          need = Math.floor(bo / 2) + 1
        if (bo % 2 === 0 || Math.max(a, b) !== need || Math.min(a, b) >= need) throw fail()
      }
    }
  }
  if (data.cards.some((card, index) => index > 0 && sortCards(data.cards[index - 1], card) > 0))
    throw fail()
  const { unsupported_last_poll: _unsupported, note: _note, ...factsCoverage } = coverage
  const facts = {
    provider,
    cards: [...data.cards].sort((a, b) => (a.display_id < b.display_id ? -1 : 1)),
    coverage: factsCoverage,
  }
  if ((await hash(facts)).slice(0, 16) !== data.facts_version) throw fail()
  return data
}

const pendingReasons = [
  'unresolved_opponents',
  'unresolved_team_names',
  'unsupported_opponent_type',
  'unresolved_start_time',
  'start_time_timezone_unknown',
  'unknown_status',
  'result_unavailable',
  'conflicting_phase_records',
]
function sortDirectoryCards(a: DisplayCard, b: DisplayCard) {
  const rank = (card: DisplayCard) =>
    card.status_label === 'In progress'
      ? 0
      : card.status_label === 'Scheduled' && card.kickoff_utc
        ? 1
        : !card.kickoff_utc
          ? 2
          : 3
  const ar = rank(a),
    br = rank(b)
  if (ar !== br) return ar - br
  if (a.kickoff_utc && b.kickoff_utc) {
    const diff = instant(a.kickoff_utc) - instant(b.kickoff_utc)
    if (diff) return (diff > 0n ? 1 : -1) * (ar === 3 ? -1 : 1)
  } else if (a.kickoff_utc !== b.kickoff_utc) return a.kickoff_utc ? -1 : 1
  return a.display_id < b.display_id ? -1 : a.display_id > b.display_id ? 1 : 0
}
function sourceClock(value: unknown, precision: DisplayCard['kickoff_precision']) {
  if (typeof value !== 'string' || !label(value, 100)) return false
  if (precision === 'source_date') return calendarDay(value)
  if (precision === 'timezone_unknown') {
    const parts = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/)
    return (
      !!parts &&
      calendarDay(parts[1]) &&
      Number(parts[2]) < 24 &&
      Number(parts[3]) < 60 &&
      Number(parts[4] || 0) < 60
    )
  }
  // Source text may preserve the original offset. Validate it without using it
  // to infer a comparison day or refresh any observation clock.
  const parts = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/,
  )
  return (
    !!parts &&
    calendarDay(parts[1]) &&
    Number(parts[2]) < 24 &&
    Number(parts[3]) < 60 &&
    Number(parts[4] || 0) < 60 &&
    Number.isFinite(Date.parse(value))
  )
}
// V2 is checked against its own exact schema and business invariants. It never
// passes through the v1 parser or fills nullable current facts from canonical data.
async function validateProviderV2(
  raw: unknown,
  provider: LiveProvider,
  manifest: DisplayManifest,
): Promise<ProviderDisplayV2> {
  keys(raw, [
    'schema_version',
    'data_kind',
    'provider',
    'facts_version',
    'canonical',
    'calendar',
    'publication',
    'directory_status',
    'directory_nodes',
    'health',
    'coverage',
    'attribution',
    'license_note',
    'cards',
  ])
  const data = raw as unknown as ProviderDisplayV2,
    { health, coverage, canonical } = data
  keys(health, [
    'state',
    'producer_state',
    'stale',
    'serving_last_good',
    'last_attempt_at',
    'last_success_at',
    'last_change_at',
    'poll_interval_seconds',
    'stale_after_seconds',
    'source_scope',
    'attempt_scope',
    'freshness_scope',
    'error_code',
    'scores_delayed',
    'update_mode',
    'in_game_round_feed',
  ])
  keys(coverage, [
    'retained_total',
    'window_total',
    'displayed',
    'clipped',
    'outside_window',
    'running_outside_window',
    'unsupported_last_poll',
    'card_limit',
    'window_from',
    'window_through',
    'window_day_utc',
    'note',
    'unknown_utc_total',
    'eligible_total',
    'eligible_undated_total',
    'pending_total',
    'pending_displayed',
    'directory_nodes_displayed',
  ])
  keys(data.attribution, ['text', 'url', 'terms_url'])
  if (
    data.schema_version !== schemaV2 ||
    manifest.schema_version !== schemaV2 ||
    data.data_kind !== 'processed_api_display' ||
    data.provider !== provider ||
    !hex(data.facts_version, 16) ||
    data.facts_version !== manifest.facts_versions[provider] ||
    canonicalDisplayJSON(data.attribution) !== canonicalDisplayJSON(credits[provider]) ||
    data.license_note !== licenseNote ||
    !Array.isArray(data.cards) ||
    data.cards.length > 500 ||
    !Array.isArray(data.directory_nodes) ||
    data.directory_nodes.length > 1500 ||
    !['observed', 'not_supplied'].includes(data.directory_status) ||
    !states.includes(health.state) ||
    (health.producer_state !== null && !states.slice(2, 8).includes(health.producer_state)) ||
    typeof health.stale !== 'boolean' ||
    typeof health.serving_last_good !== 'boolean' ||
    health.scores_delayed !== (provider === 'football-data' ? true : null) ||
    health.update_mode !== 'polled_rest' ||
    health.in_game_round_feed !== false ||
    (health.error_code !== null && !errors.includes(health.error_code))
  )
    throw fail()
  for (const clock of [health.last_attempt_at, health.last_success_at, health.last_change_at])
    if (clock !== null && (!utc(clock) || instant(clock) > instant(manifest.generated_at)))
      throw fail()
  if (
    health.last_change_at &&
    (!health.last_success_at || instant(health.last_change_at) > instant(health.last_success_at))
  )
    throw fail()
  if (health.poll_interval_seconds !== null && !integer(health.poll_interval_seconds, 86400, 30))
    throw fail()
  const threshold =
      health.poll_interval_seconds === null
        ? data.publication === null
          ? null
          : 120
        : Math.max(120, 2 * health.poll_interval_seconds),
    age = health.last_success_at
      ? Number(instant(manifest.generated_at) - instant(health.last_success_at)) / 1e6
      : null,
    stale =
      age === null ||
      threshold === null ||
      age > threshold ||
      ['invalid_publication', 'not_connected'].includes(health.state) ||
      health.serving_last_good
  if (
    health.stale_after_seconds !== threshold ||
    health.stale !== stale ||
    (age !== null && threshold === null) ||
    (['ready', 'stale', 'empty'].includes(health.state) && !health.last_success_at) ||
    (health.state === 'ready' && stale) ||
    (health.state === 'stale' && !stale)
  )
    throw fail()
  scope(health.source_scope, provider)
  scope(health.attempt_scope, provider)
  if (
    health.freshness_scope !== (health.source_scope ? 'declared_poll_scope' : 'unknown_poll_scope')
  )
    throw fail()
  if (canonical !== null) {
    keys(canonical, ['dataset_version', 'snapshot_fingerprint', 'cutoff', 'generated_at'])
    if (
      !hex(canonical.dataset_version, 16) ||
      !hex(canonical.snapshot_fingerprint, 64) ||
      !utc(canonical.cutoff) ||
      !utc(canonical.generated_at) ||
      instant(canonical.cutoff) > instant(canonical.generated_at) ||
      instant(canonical.generated_at) > instant(manifest.generated_at) ||
      (health.last_success_at && instant(canonical.cutoff) > instant(health.last_success_at))
    )
      throw fail()
  }
  if (data.calendar !== null) {
    const cal = data.calendar
    keys(cal, [
      'dataset_version',
      'calendar_fingerprint',
      'facts_version',
      'cutoff',
      'generated_at',
    ])
    if (
      provider !== 'pandascore' ||
      !hex(cal.dataset_version, 16) ||
      !hex(cal.calendar_fingerprint, 64) ||
      !hex(cal.facts_version, 16) ||
      !utc(cal.cutoff) ||
      !utc(cal.generated_at) ||
      instant(cal.cutoff) > instant(cal.generated_at) ||
      instant(cal.generated_at) > instant(manifest.generated_at) ||
      (health.last_success_at && instant(cal.cutoff) > instant(health.last_success_at))
    )
      throw fail()
  }
  if (data.publication !== null) {
    const pub = data.publication
    keys(pub, ['fingerprint', 'collected_at', 'selected_at'])
    if (
      !hex(pub.fingerprint, 64) ||
      !utc(pub.collected_at) ||
      !utc(pub.selected_at) ||
      health.last_success_at !== pub.collected_at ||
      health.last_change_at !== null ||
      health.source_scope === null ||
      instant(pub.collected_at) > instant(pub.selected_at) ||
      instant(pub.selected_at) > instant(manifest.generated_at) ||
      (canonical && instant(canonical.generated_at) > instant(pub.selected_at)) ||
      (canonical && instant(canonical.cutoff) > instant(pub.collected_at)) ||
      (data.calendar && instant(data.calendar.generated_at) > instant(pub.selected_at)) ||
      (data.calendar && instant(data.calendar.cutoff) > instant(pub.collected_at)) ||
      (provider === 'pandascore' && data.calendar === null)
    )
      throw fail()
  }
  if (data.calendar !== null && data.publication === null) throw fail()
  const observedSource =
      data.calendar !== null ||
      (provider === 'football-data' && canonical !== null && coverage.retained_total > 0),
    legacyAdaptation =
      data.calendar === null &&
      data.publication === null &&
      data.directory_status === 'not_supplied' &&
      data.cards.every((card) => card.resolution === 'legacy')
  if (data.directory_status !== (observedSource ? 'observed' : 'not_supplied') && !legacyAdaptation)
    throw fail()
  if (
    !canonical &&
    !data.calendar &&
    (data.cards.length ||
      coverage.retained_total ||
      health.serving_last_good ||
      health.state === 'ready')
  )
    throw fail()
  const counts = [
    'retained_total',
    'window_total',
    'displayed',
    'clipped',
    'outside_window',
    'running_outside_window',
    'unknown_utc_total',
    'eligible_total',
    'eligible_undated_total',
    'pending_total',
    'pending_displayed',
    'directory_nodes_displayed',
  ] as const
  if (
    !calendarDay(coverage.window_day_utc) ||
    coverage.window_day_utc > manifest.window_day_utc ||
    (coverage.window_day_utc !== manifest.window_day_utc && !health.serving_last_good) ||
    coverage.window_from !== shiftedDay(coverage.window_day_utc, -14) ||
    coverage.window_through !== shiftedDay(coverage.window_day_utc, 30) ||
    !label(coverage.note, 2000) ||
    !integer(coverage.card_limit, 500, 1) ||
    !counts.every((key) => integer(coverage[key])) ||
    (coverage.unsupported_last_poll !== null &&
      !integer(coverage.unsupported_last_poll, 1000000)) ||
    coverage.displayed !== data.cards.length ||
    coverage.displayed > coverage.card_limit ||
    coverage.eligible_total !== coverage.window_total + coverage.unknown_utc_total ||
    coverage.eligible_undated_total !== coverage.unknown_utc_total ||
    coverage.retained_total !==
      coverage.window_total + coverage.outside_window + coverage.unknown_utc_total ||
    coverage.displayed + coverage.clipped !== coverage.eligible_total ||
    coverage.running_outside_window > coverage.window_total ||
    coverage.pending_total > coverage.retained_total ||
    coverage.pending_displayed > coverage.pending_total ||
    coverage.directory_nodes_displayed !== data.directory_nodes.length
  )
    throw fail()
  const validID = (id: unknown) =>
      typeof id === 'string' && new RegExp(`^${provider}-[0-9a-f]{16}$`).test(id),
    nodes = new Map<string, DirectoryNode>(),
    referenced = new Set<string>(),
    seen = new Set<string>()
  for (const node of data.directory_nodes) {
    keys(node, [
      'display_id',
      'kind',
      'parent_id',
      'label',
      'name',
      'full_name',
      'season',
      'year',
      'identity_basis',
      'metadata_conflicted',
      'parent_conflicted',
    ])
    if (
      !validID(node.display_id) ||
      nodes.has(node.display_id) ||
      !label(node.label) ||
      !['competition', 'league', 'series', 'tournament'].includes(node.kind) ||
      (provider === 'football-data'
        ? node.kind !== 'competition' || node.parent_id !== null
        : node.kind === 'competition') ||
      (node.parent_id !== null && !validID(node.parent_id)) ||
      [node.name, node.full_name].some((name) => name !== null && !label(name, 240)) ||
      (node.season !== null && !label(node.season)) ||
      (node.year !== null && !integer(node.year, 2200, 1900)) ||
      !['source_identity', 'observed_label', 'unresolved_metadata'].includes(node.identity_basis) ||
      typeof node.metadata_conflicted !== 'boolean' ||
      typeof node.parent_conflicted !== 'boolean' ||
      (node.parent_conflicted && node.parent_id !== null)
    )
      throw fail()
    nodes.set(node.display_id, node)
  }
  for (const node of nodes.values()) {
    if (node.parent_id) {
      const parent = nodes.get(node.parent_id)
      if (
        !parent ||
        (node.kind === 'series'
          ? parent.kind !== 'league'
          : node.kind === 'tournament'
            ? parent.kind !== 'series'
            : true)
      )
        throw fail()
    }
  }
  if (data.directory_status === 'not_supplied' && nodes.size) throw fail()
  for (const card of data.cards) {
    keys(card, [
      'display_id',
      'sport',
      'competition_label',
      'team_a',
      'team_b',
      'kickoff_utc',
      'day_utc',
      'kickoff_label',
      'status_label',
      'series_format',
      'score_label',
      'result_state',
      'winning_side',
      'event_node_ids',
      'announcement_label',
      'kickoff_precision',
      'kickoff_source_text',
      'resolution',
      'pending_reasons',
      'association_state',
    ])
    for (const team of [card.team_a, card.team_b])
      if (team !== null) {
        keys(team, ['display_id', 'label'])
        if (!validID(team.display_id) || !label(team.label)) throw fail()
      }
    if (
      !validID(card.display_id) ||
      seen.has(card.display_id) ||
      (card.team_a && card.team_b && card.team_a.display_id === card.team_b.display_id) ||
      card.sport !== (provider === 'football-data' ? 'football' : 'valorant') ||
      !label(card.competition_label) ||
      (card.announcement_label !== null && !label(card.announcement_label, 240)) ||
      !['Scheduled', 'In progress', 'Finished', 'Cancelled', 'Postponed', 'Unknown'].includes(
        card.status_label,
      ) ||
      !['utc', 'source_date', 'timezone_unknown', 'unknown'].includes(card.kickoff_precision) ||
      !['validated', 'pending', 'conflicted', 'legacy'].includes(card.resolution) ||
      ![
        'none',
        'associated_historical',
        'matches_latest_announcement',
        'canonical_record',
      ].includes(card.association_state) ||
      !Array.isArray(card.pending_reasons) ||
      card.pending_reasons.length > 8 ||
      card.pending_reasons.some((reason) => !pendingReasons.includes(reason)) ||
      JSON.stringify(card.pending_reasons) !==
        JSON.stringify([...new Set(card.pending_reasons)].sort()) ||
      !Array.isArray(card.event_node_ids) ||
      card.event_node_ids.length > (provider === 'football-data' ? 1 : 3) ||
      new Set(card.event_node_ids).size !== card.event_node_ids.length ||
      card.event_node_ids.some((id) => !nodes.has(id))
    )
      throw fail()
    seen.add(card.display_id)
    let prior = -1
    for (const id of card.event_node_ids) {
      const node = nodes.get(id)!,
        rank = ['competition', 'league', 'series', 'tournament'].indexOf(node.kind)
      if (rank <= prior) throw fail()
      prior = rank
      referenced.add(id)
    }
    const latest = card.association_state === 'matches_latest_announcement',
      legacyCard = card.resolution === 'legacy'
    if (
      (latest &&
        (provider !== 'pandascore' ||
          data.calendar === null ||
          canonical === null ||
          card.resolution !== 'validated' ||
          card.pending_reasons.length > 0)) ||
      (card.association_state === 'associated_historical' &&
        (data.calendar === null || canonical === null)) ||
      (legacyCard &&
        (data.publication !== null ||
          data.calendar !== null ||
          data.directory_status !== 'not_supplied' ||
          card.association_state !== 'canonical_record' ||
          card.pending_reasons.length > 0)) ||
      (card.pending_reasons.length > 0 && !['pending', 'conflicted'].includes(card.resolution)) ||
      (card.resolution === 'conflicted' &&
        !card.pending_reasons.includes('conflicting_phase_records')) ||
      (card.association_state === 'canonical_record' &&
        !(
          canonical !== null &&
          (legacyCard ||
            (provider === 'football-data' &&
              card.resolution === 'validated' &&
              data.calendar === null))
        ))
    )
      throw fail()
    if (card.kickoff_precision === 'utc') {
      if (
        !utc(card.kickoff_utc) ||
        card.day_utc !== card.kickoff_utc.slice(0, 10) ||
        card.kickoff_label !== `${card.kickoff_utc.slice(11, 16)} UTC` ||
        ((card.day_utc < coverage.window_from || card.day_utc > coverage.window_through) &&
          card.status_label !== 'In progress')
      )
        throw fail()
    } else if (card.kickoff_utc !== null || card.day_utc !== null || card.kickoff_label !== null)
      throw fail()
    if (
      (card.kickoff_source_text !== null &&
        !sourceClock(card.kickoff_source_text, card.kickoff_precision)) ||
      (['source_date', 'timezone_unknown'].includes(card.kickoff_precision) &&
        !card.kickoff_source_text) ||
      (card.kickoff_precision === 'unknown' && card.kickoff_source_text !== null) ||
      (card.series_format !== null &&
        (typeof card.series_format !== 'string' ||
          (provider === 'football-data'
            ? card.series_format !== 'Single match'
            : !/^Best of (?:[1-9]|[1-9][0-9]|10[01])$/.test(card.series_format))))
    )
      throw fail()
    if (card.score_label === null) {
      if (card.result_state !== 'unavailable' || card.winning_side !== null) throw fail()
    } else {
      if (
        typeof card.score_label !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,2}|1000)–(?:0|[1-9][0-9]{0,2}|1000)$/.test(card.score_label) ||
        !['Finished', 'In progress'].includes(card.status_label) ||
        !card.team_a ||
        !card.team_b ||
        card.resolution === 'conflicted' ||
        !card.kickoff_utc ||
        instant(card.kickoff_utc) > instant(manifest.generated_at)
      )
        throw fail()
      const [a, b] = card.score_label.split('–').map(Number)
      if (card.result_state === 'final') {
        const latest =
            card.resolution === 'validated' &&
            card.association_state === 'matches_latest_announcement',
          canonicalOnly =
            card.association_state === 'canonical_record' &&
            ((provider === 'football-data' && card.resolution === 'validated' && !data.calendar) ||
              (card.resolution === 'legacy' &&
                !data.calendar &&
                !data.publication &&
                data.directory_status === 'not_supplied'))
        if (
          card.status_label !== 'Finished' ||
          (!latest && !canonicalOnly) ||
          !canonical ||
          a > 50 ||
          b > 50 ||
          card.winning_side !== (a > b ? 'team_a' : b > a ? 'team_b' : 'draw')
        )
          throw fail()
        if (provider === 'pandascore') {
          const bo = Number(card.series_format?.slice(8)),
            need = Math.floor(bo / 2) + 1
          if (!bo || bo % 2 === 0 || Math.max(a, b) !== need || Math.min(a, b) >= need) throw fail()
        }
      } else if (card.result_state === 'provisional') {
        const latest =
            card.resolution === 'validated' &&
            card.association_state === 'matches_latest_announcement',
          canonicalOnly =
            card.association_state === 'canonical_record' &&
            ((provider === 'football-data' && card.resolution === 'validated' && !data.calendar) ||
              (card.resolution === 'legacy' &&
                !data.calendar &&
                !data.publication &&
                data.directory_status === 'not_supplied'))
        if (
          card.status_label !== 'In progress' ||
          !canonical ||
          (!latest && !canonicalOnly) ||
          card.winning_side !== null ||
          a > 50 ||
          b > 50
        )
          throw fail()
      } else if (
        card.result_state !== 'source_reported' ||
        card.winning_side !== null ||
        provider !== 'pandascore' ||
        data.calendar === null
      )
        throw fail()
    }
  }
  // Every published node belongs to a displayed card or one of its ancestors.
  for (const id of [...referenced]) {
    let parent = nodes.get(id)?.parent_id
    while (parent) {
      referenced.add(parent)
      parent = nodes.get(parent)?.parent_id
    }
  }
  if (
    referenced.size !== nodes.size ||
    coverage.pending_displayed !==
      data.cards.filter((card) => card.pending_reasons.length > 0).length ||
    data.cards.filter((card) => !card.day_utc).length > coverage.unknown_utc_total ||
    data.cards.some((card, i) => i > 0 && sortDirectoryCards(data.cards[i - 1], card) > 0)
  )
    throw fail()
  const { unsupported_last_poll: _unsupported, note: _note, ...factsCoverage } = coverage,
    facts = {
      provider,
      cards: [...data.cards].sort((a, b) => (a.display_id < b.display_id ? -1 : 1)),
      directory_nodes: [...data.directory_nodes].sort((a, b) =>
        a.display_id < b.display_id ? -1 : 1,
      ),
      directory_status: data.directory_status,
      coverage: factsCoverage,
    }
  if ((await hash(facts)).slice(0, 16) !== data.facts_version) throw fail()
  return data
}

async function asset(filename: string, max: number, signal: AbortSignal): Promise<Uint8Array> {
  const url = new URL(`${import.meta.env.BASE_URL}current/${filename}`, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !['manifest.json', 'football-data.json', 'pandascore.json'].includes(filename)
  )
    throw fail()
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw fail(`The published current-data request failed (${response.status}).`)
  if (
    new URL(response.url).origin !== window.location.origin ||
    !response.body ||
    Number(response.headers.get('Content-Length') || 0) > max
  )
    throw fail()
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel()
        throw fail()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
const decode = (bytes: Uint8Array) => {
  try {
    return parseJSON(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    throw fail()
  }
}
export async function loadPublishedDisplay(
  signal: AbortSignal,
  previous?: DisplayPackage,
): Promise<DisplayPackage> {
  if (!publishedCurrentEnabled)
    throw fail('Published current-data display is not enabled in this profile.')
  const timeout = new AbortController(),
    timer = window.setTimeout(() => timeout.abort(), 15000),
    combined = AbortSignal.any([signal, timeout.signal])
  try {
    const manifest = validateManifest(
      decode(await asset('manifest.json', 65536, combined)),
      Date.now(),
    )
    if (
      (await hash({
        schema_version: manifest.schema_version,
        display_version: manifest.display_version,
        files: manifest.files,
      })) !== manifest.package_fingerprint
    )
      throw fail()
    // Only a fully equal, previously verified manifest can reuse its accepted
    // package. Matching the short display identity alone is insufficient.
    if (previous && canonicalDisplayJSON(manifest) === canonicalDisplayJSON(previous.manifest))
      return previous
    const payloads = await Promise.all(
      providers.map(async (provider) => {
        const filename = `${provider}.json` as keyof DisplayManifest['files'],
          bytes = await asset(filename, 2 * 1024 * 1024, combined)
        if ((await sha(bytes)) !== manifest.files[filename])
          throw fail(
            'Published current-data checksum verification failed. Previous verified cards were retained.',
          )
        return manifest.schema_version === schema
          ? validateProviderV1(decode(bytes), provider, manifest)
          : validateProviderV2(decode(bytes), provider, manifest)
      }),
    )
    const values = { 'football-data': payloads[0], pandascore: payloads[1] }
    if ((await hash(values)).slice(0, 16) !== manifest.display_version) throw fail()
    const latest = validateManifest(
      decode(await asset('manifest.json', 65536, combined)),
      Date.now(),
    )
    if (canonicalDisplayJSON(latest) !== canonicalDisplayJSON(manifest))
      throw fail(
        'The published package changed during this check. Previous verified cards were retained; the next refresh will retry.',
      )
    return { manifest, providers: values }
  } catch (error) {
    if (timeout.signal.aborted && !signal.aborted)
      throw fail(
        'The published current-data check timed out. Previous verified cards were retained.',
      )
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
export async function loadLocalDisplay(signal: AbortSignal): Promise<DisplayPackage> {
  if (import.meta.env.VITE_STATIC_DEMO === 'true')
    throw fail('Local current-data display is unavailable in this profile.')
  const timeout = new AbortController(),
    timer = window.setTimeout(() => timeout.abort(), 15000),
    combined = AbortSignal.any([signal, timeout.signal]),
    base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, ''),
    url = new URL(`${base}/live/display`, window.location.origin)
  if (url.origin !== window.location.origin) throw fail()
  try {
    const response = await fetch(url, { signal: combined, cache: 'no-store', credentials: 'omit' }),
      max = 9 * 1024 * 1024
    if (!response.ok) throw fail(`The local current-data request failed (${response.status}).`)
    if (
      !response.body ||
      new URL(response.url).origin !== window.location.origin ||
      Number(response.headers.get('Content-Length') || 0) > max
    )
      throw fail()
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        size += item.value.byteLength
        if (size > max) {
          await reader.cancel()
          throw fail()
        }
        chunks.push(item.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return validateLocalDisplayEnvelope(decode(bytes), Date.now())
  } finally {
    window.clearTimeout(timer)
  }
}
export async function validateLocalDisplayEnvelope(
  raw: unknown,
  now: number,
): Promise<DisplayPackage> {
  keys(raw, ['manifest_json', 'provider_json', 'canonical_links', 'captured_at'])
  const envelope = raw as {
    manifest_json: string
    provider_json: Record<LiveProvider, string>
    canonical_links: Record<LiveProvider, Record<string, CanonicalLink>>
    captured_at: string
  }
  keys(envelope.provider_json, providers)
  keys(envelope.canonical_links, providers)
  if (
    !utc(envelope.captured_at) ||
    instant(envelope.captured_at) > BigInt(now) * 1000n ||
    typeof envelope.manifest_json !== 'string' ||
    encoder.encode(envelope.manifest_json).length > 65536
  )
    throw fail()
  const manifest = validateManifest(parseJSON(envelope.manifest_json), now)
  if (
    manifest.schema_version !== schemaV2 ||
    instant(manifest.generated_at) > instant(envelope.captured_at) ||
    (await hash({
      schema_version: manifest.schema_version,
      display_version: manifest.display_version,
      files: manifest.files,
    })) !== manifest.package_fingerprint
  )
    throw fail()
  const values = await Promise.all(
      providers.map(async (provider) => {
        const text = envelope.provider_json[provider]
        if (typeof text !== 'string') throw fail()
        const bytes = encoder.encode(text)
        if (
          bytes.length > 2 * 1024 * 1024 ||
          (await sha(bytes)) !== manifest.files[`${provider}.json`]
        )
          throw fail()
        return validateProviderV2(parseJSON(text), provider, manifest)
      }),
    ),
    accepted = { 'football-data': values[0], pandascore: values[1] }
  if ((await hash(accepted)).slice(0, 16) !== manifest.display_version) throw fail()
  for (const provider of providers) {
    const links = envelope.canonical_links[provider],
      body = accepted[provider]
    if (!record(links) || Object.keys(links).length > 500) throw fail()
    const cards = new Map(body.cards.map((card) => [card.display_id, card]))
    for (const [id, link] of Object.entries(links)) {
      keys(link, ['match_id', 'snapshot_fingerprint'])
      const card = cards.get(id)
      if (
        !card ||
        !card.team_a ||
        !card.team_b ||
        !card.kickoff_utc ||
        !['validated', 'legacy'].includes(card.resolution) ||
        card.pending_reasons.length ||
        !['matches_latest_announcement', 'canonical_record'].includes(card.association_state) ||
        !body.canonical ||
        link.snapshot_fingerprint !== body.canonical.snapshot_fingerprint ||
        typeof link.match_id !== 'string' ||
        !new RegExp(`^${provider}:[0-9]{1,20}$`).test(link.match_id) ||
        id !==
          `${provider}-${(await sha(encoder.encode(`${provider}\0match\0${link.match_id}`))).slice(0, 16)}`
      )
        throw fail()
    }
  }
  return { manifest, providers: accepted, canonical_links: envelope.canonical_links }
}
export function displayStale(data: Pick<ProviderDisplay, 'health'>, now = Date.now()) {
  const health = data.health
  return (
    health.stale ||
    health.serving_last_good ||
    !health.last_success_at ||
    !health.stale_after_seconds ||
    now - Date.parse(health.last_success_at) > health.stale_after_seconds * 1000
  )
}
export function dateFilterError(filters: LiveFilters): string {
  const from = filters.from || '',
    through = filters.through || ''
  if ((from && !calendarDay(from)) || (through && !calendarDay(through)))
    return 'Enter a real UTC calendar date using YYYY-MM-DD.'
  if (from && through && from > through) return 'From must be on or before Through.'
  if (from && through && Date.parse(through) - Date.parse(from) > 365 * 86400000)
    return 'Choose a UTC range of 366 days or less.'
  return ''
}
export function cardInEvent(card: DisplayCard, eventID: string, nodes: Map<string, DirectoryNode>) {
  return card.event_node_ids.some((id) => {
    let node = nodes.get(id)
    while (node) {
      if (node.display_id === eventID) return true
      node = nodes.get(node.parent_id || '')
    }
    return false
  })
}
export function filterDisplayCards(
  cards: DisplayCard[],
  filters: LiveFilters,
  directory: DirectoryNode[] = [],
) {
  const selected = {
      running: 'In progress',
      scheduled: 'Scheduled',
      finished: 'Finished',
      cancelled: 'Cancelled',
      postponed: 'Postponed',
      all: '',
    }[filters.status],
    search = filters.search.trim().toLocaleLowerCase('en'),
    nodes = new Map(directory.map((node) => [node.display_id, node]))
  if (dateFilterError(filters)) return []
  return cards.filter(
    (card) =>
      (!selected || card.status_label === selected) &&
      (!filters.event || cardInEvent(card, filters.event, nodes)) &&
      (card.day_utc
        ? (!filters.from || card.day_utc >= filters.from) &&
          (!filters.through || card.day_utc <= filters.through)
        : filters.includeUnresolved !== false) &&
      (!search ||
        `${card.competition_label} ${card.announcement_label || ''} ${card.team_a?.label || ''} ${card.team_b?.label || ''} ${card.event_node_ids
          .map((id) => {
            const node = nodes.get(id)
            return node
              ? `${node.label} ${node.name || ''} ${node.full_name || ''} ${node.season || ''} ${node.year || ''}`
              : ''
          })
          .join(' ')}`
          .toLocaleLowerCase('en')
          .includes(search)),
  )
}
export function usePublishedDisplay(refresh: number) {
  const [state, setState] = useState<{ data?: DisplayPackage; error: string; loading: boolean }>({
      error: '',
      loading: true,
    }),
    sequence = useRef(0),
    verified = useRef<DisplayPackage | undefined>(undefined)
  useEffect(() => {
    const current = ++sequence.current,
      controller = new AbortController()
    let timer: number | undefined
    async function load() {
      setState((old) => ({ ...old, loading: true }))
      try {
        const data = publishedCurrentEnabled
          ? await loadPublishedDisplay(controller.signal, verified.current)
          : await loadLocalDisplay(controller.signal)
        if (current === sequence.current && !controller.signal.aborted) {
          verified.current = data
          setState({ data, error: '', loading: false })
        }
      } catch (error) {
        if (current === sequence.current && !controller.signal.aborted)
          setState((old) => ({
            ...old,
            error: error instanceof Error ? error.message : 'Published display is unavailable.',
            loading: false,
          }))
      } finally {
        if (current === sequence.current && !controller.signal.aborted)
          timer = window.setTimeout(load, 60000)
      }
    }
    void load()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [refresh])
  return state
}
