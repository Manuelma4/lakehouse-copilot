import { readFileSync } from 'node:fs'

export interface MatchObservation {
  match_id: string
  sport: 'football' | 'valorant'
  competition: string
  revision: number
  team_a_id: string
  team_b_id: string
  team_a: string
  team_b: string
  start_time: string
  observed_at: string
  completed_at: string | null
  status: string
  score_a: number | null
  score_b: number | null
  best_of: number
}

// Expectations come from the committed original observation log, never from
// a frontend transformation or the API payload we are trying to verify.
export const observations: MatchObservation[] = readFileSync(
  new URL('../../src/arena_copilot/showcase/bronze/events.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
export const manifest = JSON.parse(
  readFileSync(new URL('../../src/arena_copilot/showcase/manifest.json', import.meta.url), 'utf8'),
) as { as_of: string; dataset_version: string }

export function knownMatches(cutoff = manifest.as_of): MatchObservation[] {
  const current = new Map<string, MatchObservation>()
  for (const event of observations) {
    if (Date.parse(event.observed_at) > Date.parse(cutoff)) continue
    const previous = current.get(event.match_id)
    if (!previous || event.revision > previous.revision) current.set(event.match_id, event)
  }
  return [...current.values()].sort((a, b) => a.match_id.localeCompare(b.match_id))
}

export function preMatchReference(target: MatchObservation, count = 5) {
  const cutoff = new Date(
    Math.min(Date.parse(target.start_time), Date.parse(manifest.as_of)),
  ).toISOString()
  const previous = knownMatches(cutoff).filter(
    (m) =>
      m.sport === target.sport &&
      m.status === 'finished' &&
      m.match_id !== target.match_id &&
      m.completed_at &&
      Date.parse(m.completed_at) < Date.parse(cutoff) &&
      Date.parse(m.start_time) < Date.parse(cutoff),
  )
  previous.sort(
    (a, b) =>
      Date.parse(b.start_time) - Date.parse(a.start_time) || a.match_id.localeCompare(b.match_id),
  )
  const involves = (m: MatchObservation, id: string) => [m.team_a_id, m.team_b_id].includes(id)
  const teamA = previous.filter((m) => involves(m, target.team_a_id)).slice(0, count)
  const teamB = previous.filter((m) => involves(m, target.team_b_id)).slice(0, count)
  const h2h = previous.filter((m) => involves(m, target.team_a_id) && involves(m, target.team_b_id))
  return { cutoff, teamA, teamB, h2h }
}

export function observedFootballTable(competition: string) {
  const rows = new Map<
    string,
    {
      team_id: string
      team_name: string
      played: number
      wins: number
      draws: number
      losses: number
      goals_for: number
      goals_against: number
      points: number
    }
  >()
  for (const match of knownMatches().filter(
    (m) => m.sport === 'football' && m.competition === competition && m.status === 'finished',
  )) {
    for (const side of ['a', 'b'] as const) {
      const other = side === 'a' ? 'b' : 'a'
      const id = match[`team_${side}_id`]
      const row = rows.get(id) || {
        team_id: id,
        team_name: match[`team_${side}`],
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goals_for: 0,
        goals_against: 0,
        points: 0,
      }
      const scored = match[`score_${side}`]!,
        conceded = match[`score_${other}`]!
      row.played += 1
      row.wins += Number(scored > conceded)
      row.draws += Number(scored === conceded)
      row.losses += Number(scored < conceded)
      row.goals_for += scored
      row.goals_against += conceded
      row.points += scored > conceded ? 3 : scored === conceded ? 1 : 0
      rows.set(id, row)
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
      b.goals_for - a.goals_for ||
      a.team_id.localeCompare(b.team_id),
  )
}
