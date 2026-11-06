import { api } from './data'
import type { ChatResponse, ToolEvidence } from './types'
import type { OpenFootballMatch, OpenFootballSnapshot } from './openFootball'
import { parsedScore, resolvedUtc, resultLabel, sourceClock, sourceDay } from './openFootball'

export type ResearchContext =
  | { kind: 'match'; id: string; label: string }
  | { kind: 'team'; id: string; label: string }
  | { kind: 'edition'; id: string; label: string }
export interface ResearchResponse extends ChatResponse {
  provider: 'openfootball'
  snapshot_fingerprint: string
  contract_version: string
  tool_results: ToolEvidence[]
}

function compactMatch(match: OpenFootballMatch) {
  return {
    match_id: match.match_id,
    team_a: match.team_a,
    team_b: match.team_b,
    source_date: match.source_date,
    local_time: match.local_time,
    utc_offset_minutes: match.utc_offset_minutes ?? null,
    start_time: match.start_time,
    kickoff_precision: match.kickoff_precision,
    result_status: match.result_status,
    score_basis: match.score_basis,
    source_score_stages: parsedScore(match),
    source_group: match.source_group ?? null,
    ground: match.ground ?? null,
    source_match_number: match.source_match_number ?? null,
    prediction_eligible: false,
    observed_at: match.observed_at,
    source_sha256: match.source_sha256,
  }
}

// A fixed source browser, not simulated model inference or free-form semantic QA.
export function staticResearchAnswer(
  data: OpenFootballSnapshot,
  context: ResearchContext,
  question: string,
): ResearchResponse {
  const evidence: ToolEvidence[] = []
  let answer = '',
    abstained = false
  if (/\b(predict\w*|forecast\w*|probabilit\w*|odds|bet\w*)\b/i.test(question)) {
    answer =
      'No real-team forecast is available in this research package. Imported records are prediction-ineligible; collection timestamps do not establish historical pre-match availability.'
    evidence.push({
      tool: 'research_quality',
      source: 'quality.json',
      rows: [data.quality],
    })
    abstained = true
  } else if (
    !/\b(summary|summar\w*|coverage|records?|scores?|results?|time|clock|kickoff|date|source|evidence|identity|team|edition|revisions?|observ\w*|unknown|group|ground|venue|match)\b/i.test(
      question,
    )
  ) {
    answer =
      'The public source browser cannot interpret that question. Ask for this selected record’s scores, clock, source provenance or imported coverage. Local AI is available through the separate research API.'
    abstained = true
  } else if (context.kind === 'match') {
    const match = data.matches.find((row) => row.match_id === context.id)
    if (match) {
      const stages = parsedScore(match)
      const scores = stages
        ? Object.entries(stages)
            .filter(
              ([key, value]) =>
                ['ft', 'ht', 'et', 'p'].includes(key) && Array.isArray(value) && value.length === 2,
            )
            .map(([key, value]) => `${key.toUpperCase()} ${(value as unknown[]).join('–')}`)
            .join('; ')
        : 'No accepted source score'
      const utc = resolvedUtc(match)
      answer = `${match.team_a} vs ${match.team_b}: ${resultLabel(match).toLowerCase()}. ${scores}. Source date ${sourceDay(match.source_date)}; ${sourceClock(match)}.${utc ? ` Offset-derived kickoff ${utc}.` : ' No resolved UTC kickoff.'} Source score stages are independent; this summary does not infer a 90-minute winner or official bracket.`
      evidence.push({
        tool: 'research_match',
        source: 'gold/match_history.parquet',
        rows: [compactMatch(match)],
      })
    } else abstained = true
  } else if (context.kind === 'team') {
    const team = data.team_profiles?.find((row) => row.team_id === context.id)
    if (team) {
      answer = `${team.team_name} has ${team.record_count} accepted source records across ${team.edition_ids.length} imported editions: ${team.observed_results} observed results and ${team.unknown_results} unknown results. Its source identity is ${team.team_id} in ${team.team_namespace}. Counts describe imported coverage; no global win/draw/loss record or official identity is inferred.`
      const { recent_match_ids: _recent, ...profile } = team
      evidence.push({ tool: 'research_team', source: 'gold/matches.parquet', rows: [profile] })
    } else abstained = true
  } else {
    const edition = data.competitions.find((row) => row.edition_id === context.id)
    if (edition) {
      answer = `${edition.name}, ${edition.season}: ${edition.match_count} accepted source records, ${edition.observed_results} observed results and ${edition.unknown_results} unknown results. Imported source dates cover ${sourceDay(edition.coverage_start)} to ${sourceDay(edition.coverage_end)}. ${edition.participants.length} source-scoped participants are included. This is imported coverage, not official standings or a live feed.`
      const { participants: _participants, ...summary } = edition
      evidence.push({
        tool: 'research_competition',
        source: 'competitions.json',
        rows: [{ ...summary, participants_count: edition.participants.length }],
      })
    } else abstained = true
  }
  if (!answer)
    answer =
      'This context ID is not present in the accepted research package. No substitute entity was selected.'
  return {
    answer,
    citations: evidence.map((item) => ({
      id: item.source,
      uri: `snapshot://${data.manifest.dataset_version}/${item.source}`,
    })),
    tool_results: evidence,
    trace_id: `public-research-${crypto.randomUUID()}`,
    provider: 'openfootball',
    dataset_version: data.manifest.dataset_version,
    snapshot_fingerprint: data.snapshot_fingerprint,
    contract_version: data.manifest.research_version,
    data_kind: 'open_data',
    as_of: data.manifest.as_of,
    mode: 'static_evidence',
    abstained,
    model: null,
    metrics: { tool_calls: evidence.length },
  }
}

export async function sendResearchQuestion(
  data: OpenFootballSnapshot,
  context: ResearchContext,
  question: string,
  mode: 'ollama' | 'evidence',
) {
  const field = { match: 'match_id', team: 'team_id', edition: 'edition_id' }[context.kind]
  const response = await api<ResearchResponse>(
    '/open-football/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode, [field]: context.id }),
    },
    120000,
  )
  if (
    response.provider !== 'openfootball' ||
    response.data_kind !== 'open_data' ||
    response.dataset_version !== data.manifest.dataset_version ||
    response.snapshot_fingerprint !== data.snapshot_fingerprint ||
    response.mode !== mode ||
    !Array.isArray(response.tool_results) ||
    !Array.isArray(response.citations) ||
    typeof response.answer !== 'string'
  )
    throw new Error(
      'The research answer does not match the loaded source package. Reload the package before trying again.',
    )
  return response
}

export async function sendResearchFeedback(traceId: string, rating: -1 | 1) {
  await api('/open-football/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trace_id: traceId, rating, comment: '' }),
  })
}
