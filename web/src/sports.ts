import { api } from './data'
import type { Match, Prediction, Snapshot, Sport } from './types'

export interface Participant {
  team_id: string | null
  team_key: string
  team_name: string
  identity_source: 'match' | 'gold_unique_name' | 'unresolved'
}
export interface Competition {
  competition_id: string
  sport: Sport
  name: string
  status: 'upcoming' | 'ongoing' | 'completed' | 'inactive'
  coverage_start: string
  coverage_end: string
  first_observed_at: string
  last_observed_at: string
  match_count: number
  completed_matches: number
  upcoming_matches: number
  running_matches: number
  overdue_matches: number
  cancelled_matches: number
  postponed_matches: number
  participants: Participant[]
  coverage_label: string
  table_label: string
  score_unit: 'goals' | 'maps'
  source_providers: string[]
}
export interface FormResult {
  match_id: string
  start_time: string
  result: 'W' | 'D' | 'L'
  score_for: number
  score_against: number
  opponent_id: string | null
  opponent_name: string
}
export interface Standing extends Participant {
  position: number
  played: number
  wins: number
  draws: number
  losses: number
  score_for: number
  score_against: number
  score_difference: number
  points: number | null
  win_rate: number
  form: FormResult[]
  last_match_at: string | null
}
export interface SportsEnvelope<T> {
  dataset_version: string
  data_kind: string
  as_of: string
  rows: T[]
  total: number
  limit?: number
  offset?: number
}
export interface MatchFilters {
  sport: Sport
  status: string
  competition_id: string
  team_name: string
  search: string
  date: string
  offset: number
}
export interface CompetitionDetail extends SportsEnvelope<Match> {
  competition: Competition
  table: Standing[]
  participants: Participant[]
  date_groups: { date: string; rows: Match[] }[]
}
export interface TeamForm extends Participant {
  played: number
  wins: number
  draws: number
  losses: number
  score_for: number
  score_against: number
  rows: FormResult[]
}
export interface MatchDetail {
  match: Match
  competition: Competition
  cutoff: string
  history_basis: 'observation_history' | 'current_rows_only'
  history_label: string
  form_a: TeamForm
  form_b: TeamForm
  head_to_head: {
    total: number
    team_a_wins: number
    draws: number
    team_b_wins: number
    rows: Match[]
  }
  prediction: Prediction | null
  provenance: { providers: string[]; data_kind: string; as_of: string; coverage_label: string }
}

export function instant(value: string): bigint {
  const parts = value.match(/^(.*[Tt]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/)
  if (!parts) return BigInt(Date.parse(value)) * 1000n
  return (
    BigInt(Date.parse(parts[1] + parts[3])) * 1000n +
    BigInt((parts[2] || '').padEnd(6, '0').slice(0, 6) || '0')
  )
}
export const utcDay = (value: string) => new Date(Date.parse(value)).toISOString().slice(0, 10)
const compare = (a: string, b: string) =>
  instant(a) < instant(b) ? -1 : instant(a) > instant(b) ? 1 : 0
const matchOrder = (a: Match, b: Match) =>
  compare(b.start_time, a.start_time) ||
  (a.match_id < b.match_id ? -1 : a.match_id > b.match_id ? 1 : 0)
const keyOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export async function competitionId(sport: Sport, name: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  return `${sport}-${Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)}`
}
export function participant(match: Match, side: 'a' | 'b', data: Snapshot): Participant {
  const name = side === 'a' ? match.team_a : match.team_b
  const id = side === 'a' ? match.team_a_id : match.team_b_id
  if (id) return { team_id: id, team_key: id, team_name: name, identity_source: 'match' }
  const gold = data.teams.filter((t) => t.sport === match.sport && t.team_name === name)
  if (gold.length === 1)
    return {
      team_id: gold[0].team_id,
      team_key: gold[0].team_id,
      team_name: name,
      identity_source: 'gold_unique_name',
    }
  return {
    team_id: null,
    team_key: `unresolved:${match.sport}:${name}`,
    team_name: name,
    identity_source: 'unresolved',
  }
}
export async function deriveCompetitions(data: Snapshot): Promise<Competition[]> {
  const groups = new Map<string, Match[]>()
  data.matches.forEach((m) => {
    const key = `${m.sport}\0${m.competition}`
    groups.set(key, [...(groups.get(key) || []), m])
  })
  const derived = await Promise.all(
    [...groups.values()].map(async (matches) => {
      const first = matches[0],
        completed = matches.filter((m) => m.status === 'finished').length,
        upcoming = matches.filter(
          (m) => m.status === 'scheduled' && instant(m.start_time) > instant(data.manifest.as_of),
        ).length,
        running = matches.filter((m) => m.status === 'running').length
      const overdue = matches.filter(
        (m) => m.status === 'scheduled' && instant(m.start_time) <= instant(data.manifest.as_of),
      ).length
      const participants = new Map<string, Participant>()
      const ordered = [...matches].sort(
        (a, b) => compare(a.observed_at, b.observed_at) || keyOrder(a.match_id, b.match_id),
      )
      ordered.forEach((m) => {
        for (const side of ['a', 'b'] as const) {
          const p = participant(m, side, data)
          participants.set(p.team_key, p)
        }
      })
      const sorted = [...matches].sort(
          (a, b) => compare(a.start_time, b.start_time) || keyOrder(a.match_id, b.match_id),
        ),
        observed = matches.map((m) => m.observed_at).sort(compare)
      return {
        competition_id: await competitionId(first.sport, first.competition),
        sport: first.sport,
        name: first.competition,
        status:
          running || (completed && upcoming)
            ? 'ongoing'
            : upcoming
              ? 'upcoming'
              : completed && !overdue && !matches.some((m) => m.status === 'postponed')
                ? 'completed'
                : 'inactive',
        coverage_start: utcDay(sorted[0].start_time),
        coverage_end: utcDay(sorted[sorted.length - 1].start_time),
        first_observed_at: observed[0],
        last_observed_at: observed[observed.length - 1],
        match_count: matches.length,
        completed_matches: completed,
        upcoming_matches: upcoming,
        running_matches: running,
        overdue_matches: overdue,
        cancelled_matches: matches.filter((m) => m.status === 'cancelled').length,
        postponed_matches: matches.filter((m) => m.status === 'postponed').length,
        participants: [...participants.values()].sort((a, b) => keyOrder(a.team_key, b.team_key)),
        coverage_label: 'Observed snapshot coverage',
        table_label: 'Observed results table — not official standings',
        score_unit: first.sport === 'football' ? 'goals' : 'maps',
        source_providers: [
          ...new Set(
            matches.map(
              (m) => m.provider || data.manifest.providers?.[0] || data.manifest.data_kind,
            ),
          ),
        ],
      } as Competition
    }),
  )
  return derived.sort(
    (a, b) =>
      compare(b.coverage_start, a.coverage_start) || keyOrder(b.competition_id, a.competition_id),
  )
}
export function teamSide(match: Match, team: Participant, data: Snapshot): 'a' | 'b' | undefined {
  const a = participant(match, 'a', data),
    b = participant(match, 'b', data)
  if (a.team_key === b.team_key) return undefined
  if (a.team_key === team.team_key) return 'a'
  if (b.team_key === team.team_key) return 'b'
  return undefined
}
export function resultFor(match: Match, team: Participant, data: Snapshot): FormResult {
  const a = teamSide(match, team, data) === 'a',
    scored = (a ? match.score_a : match.score_b) ?? 0,
    conceded = (a ? match.score_b : match.score_a) ?? 0
  return {
    match_id: match.match_id,
    start_time: match.start_time,
    result: scored === conceded ? 'D' : scored > conceded ? 'W' : 'L',
    score_for: scored,
    score_against: conceded,
    opponent_id: (a ? match.team_b_id : match.team_a_id) || null,
    opponent_name: a ? match.team_b : match.team_a,
  }
}
export function observedTable(
  matches: Match[],
  participants: Participant[],
  sport: Sport,
  data: Snapshot,
): Standing[] {
  const rows = participants
    .map((p) => {
      const results = matches
        .filter((m) => m.status === 'finished' && teamSide(m, p, data) !== undefined)
        .sort(matchOrder)
        .map((m) => resultFor(m, p, data))
      const wins = results.filter((r) => r.result === 'W').length,
        draws = results.filter((r) => r.result === 'D').length,
        score_for = results.reduce((v, r) => v + r.score_for, 0),
        score_against = results.reduce((v, r) => v + r.score_against, 0)
      return {
        ...p,
        position: 0,
        played: results.length,
        wins,
        draws,
        losses: results.length - wins - draws,
        score_for,
        score_against,
        score_difference: score_for - score_against,
        points: sport === 'football' ? wins * 3 + draws : null,
        win_rate: results.length ? wins / results.length : 0,
        form: results.slice(0, 5),
        last_match_at:
          matches
            .filter(
              (m) =>
                m.status === 'finished' && teamSide(m, p, data) !== undefined && m.completed_at,
            )
            .map((m) => m.completed_at!)
            .sort(compare)
            .at(-1) || null,
      }
    })
    .sort((a, b) =>
      sport === 'football'
        ? (b.points ?? 0) - (a.points ?? 0) ||
          b.score_difference - a.score_difference ||
          b.score_for - a.score_for ||
          keyOrder(a.team_key, b.team_key)
        : b.wins - a.wins ||
          b.score_difference - a.score_difference ||
          b.win_rate - a.win_rate ||
          keyOrder(a.team_key, b.team_key),
    )
  return rows.map((r, i) => ({ ...r, position: i + 1 }))
}
export function pointInTime(data: Snapshot, target: Match) {
  const cutoff =
    instant(target.start_time) < instant(data.manifest.as_of)
      ? target.start_time
      : data.manifest.as_of
  const latest = new Map<string, Match>()
  for (const m of data.match_history || data.matches)
    if (
      m.sport === target.sport &&
      m.match_id !== target.match_id &&
      instant(m.observed_at) <= instant(cutoff) &&
      (!latest.has(m.match_id) || m.revision > latest.get(m.match_id)!.revision)
    )
      latest.set(m.match_id, m)
  const rows = [...latest.values()]
    .filter(
      (m) =>
        m.status === 'finished' &&
        instant(m.start_time) < instant(cutoff) &&
        !!m.completed_at &&
        instant(m.completed_at) < instant(cutoff),
    )
    .sort(matchOrder)
  const a = participant(target, 'a', data),
    b = participant(target, 'b', data)
  return {
    cutoff,
    history_basis: data.match_history ? 'observation_history' : 'current_rows_only',
    rows,
    form_a: rows
      .filter((m) => teamSide(m, a, data) !== undefined)
      .slice(0, 5)
      .map((m) => resultFor(m, a, data)),
    form_b: rows
      .filter((m) => teamSide(m, b, data) !== undefined)
      .slice(0, 5)
      .map((m) => resultFor(m, b, data)),
    head_to_head: rows.filter(
      (m) => teamSide(m, a, data) !== undefined && teamSide(m, b, data) !== undefined,
    ),
  }
}
export function filterMatches(data: Snapshot, competitions: Competition[], filters: MatchFilters) {
  const competition = competitions.find((c) => c.competition_id === filters.competition_id)
  if (filters.competition_id && !competition) return { rows: [], total: 0 }
  const filtered = data.matches
    .filter(
      (m) =>
        m.sport === filters.sport &&
        (!filters.status || m.status === filters.status) &&
        (!competition || m.competition === competition.name) &&
        (!filters.team_name || [m.team_a, m.team_b].includes(filters.team_name)) &&
        (!filters.date || utcDay(m.start_time) === filters.date) &&
        (!filters.search ||
          `${m.team_a} ${m.team_b} ${m.competition} ${m.match_id}`
            .toLowerCase()
            .includes(filters.search.toLowerCase())),
    )
    .sort((a, b) =>
      filters.status === 'scheduled'
        ? compare(a.start_time, b.start_time) || keyOrder(a.match_id, b.match_id)
        : matchOrder(a, b),
    )
  return { rows: filtered.slice(filters.offset, filters.offset + 25), total: filtered.length }
}
export async function listCompetitions(sport: Sport) {
  return api<SportsEnvelope<Competition>>(`/competitions?sport=${sport}&limit=100`)
}
export function getForecast(data: Snapshot, match: Match): Prediction | undefined {
  return data.predictions.find((p) => p.match_id === match.match_id)
}
export async function queryMatches(filters: MatchFilters) {
  const params = new URLSearchParams({
    sport: filters.sport,
    limit: '25',
    offset: String(filters.offset),
    order: filters.status === 'scheduled' ? 'asc' : 'desc',
  })
  if (filters.status) params.set('status', filters.status)
  if (filters.competition_id) params.set('competition_id', filters.competition_id)
  if (filters.team_name) params.set('team_name', filters.team_name)
  if (filters.search) params.set('search', filters.search)
  if (filters.date) {
    params.set('date_from', filters.date)
    params.set('date_to', filters.date)
  }
  return api<SportsEnvelope<Match>>(`/matches?${params}`)
}
export function localCompetitionDetail(
  data: Snapshot,
  competition: Competition,
): CompetitionDetail {
  const matches = data.matches
    .filter((m) => m.sport === competition.sport && m.competition === competition.name)
    .sort(matchOrder)
  return {
    ...data.manifest,
    competition,
    participants: competition.participants,
    table: observedTable(matches, competition.participants, competition.sport, data),
    rows: matches.slice(0, 100),
    date_groups: [],
    total: matches.length,
  }
}
export function localMatchDetail(
  data: Snapshot,
  match: Match,
  competition: Competition,
): MatchDetail {
  const pit = pointInTime(data, match)
  const form = (side: 'a' | 'b'): TeamForm => {
    const p = participant(match, side, data),
      results = pit.rows
        .filter((m) => teamSide(m, p, data) !== undefined)
        .slice(0, 5)
        .map((m) => resultFor(m, p, data))
    return {
      ...p,
      played: results.length,
      wins: results.filter((r) => r.result === 'W').length,
      draws: results.filter((r) => r.result === 'D').length,
      losses: results.filter((r) => r.result === 'L').length,
      score_for: results.reduce((n, r) => n + r.score_for, 0),
      score_against: results.reduce((n, r) => n + r.score_against, 0),
      rows: results.slice(0, 5),
    }
  }
  const results = pit.head_to_head.map((m) => resultFor(m, participant(match, 'a', data), data))
  return {
    match,
    competition,
    cutoff: pit.cutoff,
    history_basis: data.match_history ? 'observation_history' : 'current_rows_only',
    history_label: data.match_history
      ? 'Observation history known by cutoff'
      : 'Conservative current rows known by cutoff',
    form_a: form('a'),
    form_b: form('b'),
    head_to_head: {
      total: results.length,
      team_a_wins: results.filter((r) => r.result === 'W').length,
      draws: results.filter((r) => r.result === 'D').length,
      team_b_wins: results.filter((r) => r.result === 'L').length,
      rows: pit.head_to_head.slice(0, 10),
    },
    prediction: getForecast(data, match) || null,
    provenance: {
      providers: competition.source_providers,
      data_kind: data.manifest.data_kind,
      as_of: data.manifest.as_of,
      coverage_label: 'Observed snapshot coverage',
    },
  }
}
export function fetchCompetitionDetail(id: string) {
  return api<CompetitionDetail>(`/competitions/${encodeURIComponent(id)}?limit=100`)
}
export function fetchMatchDetail(id: string) {
  return api<MatchDetail>(`/matches/${encodeURIComponent(id)}`)
}
