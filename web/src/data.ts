import type { ChatResponse, Connection, Manifest, OverviewSummary, Snapshot, Sport } from './types'

const apiBase = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
const staticUrl = `${import.meta.env.BASE_URL}snapshot.json`
export async function api<T>(path: string, options: RequestInit = {}, timeout = 12000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  try {
    if (import.meta.env.VITE_STATIC_DEMO === 'true')
      throw new Error('Explicit published snapshot mode')
    const response = await fetch(`${apiBase}${path}`, { ...options, signal: controller.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.detail || `Request failed (${response.status}).`)
    }
    return (await response.json()) as T
  } finally {
    window.clearTimeout(timer)
  }
}

type Envelope<T> = Manifest & { rows: T[]; incidents?: Snapshot['incidents']; total?: number }
export async function loadData(): Promise<{ snapshot: Snapshot; connection: Connection }> {
  try {
    await api('/health', {}, 1600)
    const [
      matches,
      teams,
      predictions,
      models,
      quality,
      catalog,
      lineage,
      documents,
      football,
      valorant,
    ] = await Promise.all([
      api<Envelope<Snapshot['matches'][number]>>('/matches'),
      api<Envelope<Snapshot['teams'][number]>>('/teams'),
      api<Envelope<Snapshot['predictions'][number]>>('/predictions'),
      api<Envelope<{ sport: Sport } & Snapshot['model_report']['sports']['football']>>('/models'),
      api<Envelope<Snapshot['quality']>>('/quality'),
      api<Envelope<Snapshot['catalog'][number]>>('/catalog'),
      api<Envelope<Snapshot['lineage'][number]>>('/lineage'),
      api<Envelope<Snapshot['documents'][number]>>('/documents'),
      api<{ summary: OverviewSummary }>('/overview?sport=football'),
      api<{ summary: OverviewSummary }>('/overview?sport=valorant'),
    ])
    const manifest = {
      schema_version: '2.0',
      dataset_version: matches.dataset_version,
      data_kind: matches.data_kind,
      as_of: matches.as_of,
    }
    return {
      connection: 'local',
      snapshot: {
        manifest,
        matches: matches.rows,
        match_total: matches.total,
        overview: { football: football.summary, valorant: valorant.summary },
        teams: teams.rows,
        predictions: predictions.rows,
        model_report: { sports: Object.fromEntries(models.rows.map((m) => [m.sport, m])) },
        quality: quality.rows[0],
        incidents: quality.incidents || [],
        catalog: catalog.rows,
        lineage: lineage.rows,
        documents: documents.rows,
      },
    }
  } catch {
    const response = await fetch(staticUrl)
    if (!response.ok)
      throw new Error(
        'Neither the local API nor the published snapshot is available. Start the API, or generate web/public/snapshot.json with the snapshot export script.',
      )
    const snapshot = (await response.json()) as Snapshot
    if (
      !snapshot.manifest?.dataset_version ||
      !Array.isArray(snapshot.matches) ||
      !Array.isArray(snapshot.teams) ||
      !Array.isArray(snapshot.predictions) ||
      !snapshot.quality?.summary
    )
      throw new Error(
        'The public snapshot is missing required data. Generate a fresh validated export.',
      )
    return { snapshot, connection: 'snapshot' }
  }
}

export async function sendChat(
  question: string,
  mode: 'evidence' | 'ollama',
  retrieval: 'lexical' | 'hybrid',
): Promise<ChatResponse> {
  const response = await api<ChatResponse & { tool_results?: ChatResponse['tools'] }>(
    '/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode, retrieval }),
    },
    240000,
  )
  return { ...response, tools: response.tool_results || response.tools }
}
export async function feedback(trace_id: string, rating: number): Promise<void> {
  await api('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trace_id, rating, comment: '' }),
  })
}

export function staticAnswer(question: string, data: Snapshot, sport: Sport): ChatResponse {
  const lower = question.toLowerCase()
  const tools: NonNullable<ChatResponse['tools']> = []
  let answer = '',
    abstained = false
  const predictionIntent = /predict|probabilit|forecast|win chances/.test(lower)
  const mentioned = data.teams.filter((t) => lower.includes(t.team_name.toLowerCase()))
  const id = question.match(/\b(?:synthetic|football-data|pandascore):[\w:-]+/)?.[0]
  if (predictionIntent) {
    let found = id
      ? data.predictions.filter((p) => p.match_id === id)
      : data.predictions.filter(
          (p) =>
            p.sport === sport &&
            (mentioned.length === 0 ||
              mentioned.some((t) => [p.team_a, p.team_b].includes(t.team_name))),
        )
    if (!id && mentioned.length > 1)
      found = found.filter((p) =>
        mentioned.every((t) => [p.team_a, p.team_b].includes(t.team_name)),
      )
    tools.push({ tool: 'get_prediction', source: 'predictions.json', rows: found })
    if (found.length === 1) {
      const p = found[0]
      answer = `The stored forecast for ${p.team_a} vs ${p.team_b} gives ${p.team_a} ${(p.probabilities.a * 100).toFixed(1)}%, ${p.team_b} ${(p.probabilities.b * 100).toFixed(1)}%${p.probabilities.draw !== undefined ? ` and a draw ${(p.probabilities.draw * 100).toFixed(1)}%` : ''}. These are uncalibrated ${p.data_kind} demonstration probabilities from ${p.model}, using only evidence available as of ${p.as_of}. They do not establish real-team performance.`
    } else if (found.length > 1) {
      answer = `There are ${found.length} stored ${sport} forecasts matching your question. Choose an exact match from Forecasts and ask about its match ID to get a single prediction.`
      abstained = true
    } else {
      answer =
        'No stored forecast matches that identifier or team. I cannot produce a new probability from the public snapshot.'
      abstained = true
    }
  } else if (mentioned.length) {
    const selected = mentioned.filter((t) => t.sport === sport)
    tools.push({ tool: 'get_team_stats', source: 'gold/team_stats.parquet', rows: selected })
    answer = selected
      .map(
        (t) =>
          `${t.team_name}: ${t.matches} completed matches, ${t.wins} wins, ${t.draws} draws and ${t.losses} losses; win rate ${(t.win_rate * 100).toFixed(1)}%. ${t.score_for} ${t.sport === 'football' ? 'goals' : 'maps'} scored, ${t.score_against} conceded.`,
      )
      .join('\n\n')
    if (!selected.length) {
      answer =
        'That team belongs to the other sport. Change the sport selector to inspect its evidence.'
      abstained = true
    }
  } else if (/quality|quarantine|incident/.test(lower)) {
    tools.push({ tool: 'get_incidents', source: 'incidents.json', rows: data.incidents })
    answer = `The snapshot contains ${data.quality.summary.valid_events.toLocaleString()} valid observations and ${data.quality.summary.quarantined} quarantined observations. The last ingestion ${data.quality.summary.last_run_status}. ${data.incidents.length} incident${data.incidents.length === 1 ? '' : 's'} are recorded. Quarantined records remain excluded from canonical match statistics.`
  } else if (/lineage|where.*data|pipeline/.test(lower)) {
    tools.push({ tool: 'get_lineage', source: 'lineage.json', rows: data.lineage })
    answer = data.lineage.map((e) => `${e.source} → ${e.target}: ${e.transformation}.`).join('\n')
  } else {
    const words = lower.match(/[a-z]{3,}/g) || []
    const docs = data.documents
      .map((d) => ({
        ...d,
        score: words.filter((w) => (d.title + ' ' + d.text).toLowerCase().includes(w)).length,
      }))
      .filter((d) => d.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
    if (docs.length) {
      tools.push({ tool: 'search_documents', source: docs[0].id, rows: docs })
      answer = docs
        .map((d) => `${d.title}\n${d.text.replace(/^#{1,6}\s/gm, '').trim()}`)
        .join('\n\n')
    } else {
      answer =
        'The published snapshot does not contain enough evidence to answer that question. Try an exact team name, a stored match ID, data quality, prediction features or lineage. Local AI mode can explain the same evidence when Ollama is running.'
      abstained = true
    }
  }
  return {
    answer,
    tools,
    citations: [...new Set(tools.map((t) => t.source).filter(Boolean))].map((source) => ({
      id: source,
      source,
      uri: `snapshot://${data.manifest.dataset_version}/${source}`,
    })),
    trace_id: `browser-${crypto.randomUUID()}`,
    dataset_version: data.manifest.dataset_version,
    data_kind: data.manifest.data_kind,
    as_of: data.manifest.as_of,
    mode: 'snapshot_evidence',
    abstained,
    model: null,
  }
}
