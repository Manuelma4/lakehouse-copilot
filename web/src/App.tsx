import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  Globe2,
  LayoutDashboard,
  Menu,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  X,
} from 'lucide-react'
import { feedback, loadData, sendChat, staticAnswer } from './data'
import {
  MatchCenter,
  CompetitionExplorer,
  MatchDetailDrawer,
  useCompetitions,
} from './components/SportsWorkspace'
import { Badge, date, pct, Empty, ProbabilityBar, SectionTitle, Stat } from './components/ui'
import { teamSide } from './sports'
import { useOpenFootballData } from './openFootball'
import type { OpenFootballFilters } from './openFootball'
import type { LiveFilterStatus, LiveProvider } from './live'
import type {
  ChatResponse,
  Connection,
  Document,
  Match,
  ModelCard,
  Prediction,
  Snapshot,
  Sport,
  View,
} from './types'

const views: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Match center', icon: LayoutDashboard },
  { id: 'events', label: 'Competitions', icon: Flag },
  { id: 'forecasts', label: 'Forecasts', icon: Target },
  { id: 'teams', label: 'Team explorer', icon: Trophy },
  { id: 'copilot', label: 'Ask Arena', icon: MessageSquare },
  { id: 'quality', label: 'Data & models', icon: Database },
  { id: 'open-football', label: 'Open football', icon: Globe2 },
  { id: 'live', label: 'Current matches', icon: Activity },
]
const OpenFootballWorkspace = lazy(() => import('./components/OpenFootballWorkspace'))
const LiveWorkspace = lazy(() => import('./LiveWorkspace'))
function MatchTable({ matches }: { matches: Match[] }) {
  return matches.length ? (
    <div className="table-scroll">
      <table className="match-table">
        <thead>
          <tr>
            <th scope="col">Match</th>
            <th scope="col">Result</th>
            <th scope="col">Kickoff / start (UTC)</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.match_id}>
              <td>
                <div className="table-match">
                  <Badge name={m.team_a} />
                  <span>
                    {m.team_a}
                    <small>vs {m.team_b}</small>
                  </span>
                </div>
              </td>
              <td>
                <b className="score">
                  {m.status === 'finished' ? `${m.score_a} — ${m.score_b}` : '—'}
                </b>
              </td>
              <td className="muted">{date(m.start_time)}</td>
              <td>
                <span className={`status status-${m.status}`}>
                  {m.status === 'finished' ? 'Final' : m.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>No matches satisfy this filter.</Empty>
  )
}

function Forecasts({
  data,
  sport,
  ask,
}: {
  data: Snapshot
  sport: Sport
  ask: (question: string) => void
}) {
  const predictions = data.predictions.filter((p) => p.sport === sport)
  const [selected, setSelected] = useState('')
  const p = predictions.find((x) => x.match_id === selected) || predictions[0]
  return (
    <>
      <PageHeading
        eyebrow="MODELLED, NEVER GUARANTEED"
        title="Read the matchup."
        description="Stored probabilities, their feature cutoff and the evidence that produced them."
      />
      <div className="notice notice-subtle">
        <CircleHelp size={17} />
        <span>
          Scheduled at the snapshot cutoff ? Demonstration model · Uncalibrated probabilities · No
          real-world predictive claim
        </span>
      </div>
      {p ? (
        <div className="forecast-workspace">
          <section className="forecast-list">
            <SectionTitle
              title="Stored matchups"
              aside={<span className="count-badge">{predictions.length}</span>}
            />
            {predictions.map((prediction) => (
              <button
                key={prediction.match_id}
                className={`forecast-option ${prediction.match_id === p.match_id ? 'selected' : ''}`}
                aria-label={`Inspect forecast ${prediction.team_a} vs ${prediction.team_b}`}
                aria-pressed={prediction.match_id === p.match_id}
                onClick={() => setSelected(prediction.match_id)}
              >
                <span className="forecast-option-date">
                  {date(prediction.start_time)} UTC <ChevronRight size={14} />
                </span>
                <span className="forecast-option-team">
                  <Badge name={prediction.team_a} />
                  {prediction.team_a}
                </span>
                <span className="forecast-option-team">
                  <Badge name={prediction.team_b} />
                  {prediction.team_b}
                </span>
                <ProbabilityBar prediction={prediction} compact />
              </button>
            ))}
          </section>
          <section className="panel forecast-detail" aria-label="Forecast details">
            <div className="match-meta">
              <span>
                {sport === 'football' ? 'FOOTBALL · THREE OUTCOMES' : 'VALORANT · SERIES WINNER'}
              </span>
              <span>{date(p.start_time)} UTC</span>
            </div>
            <div className="matchup-preview">
              <div>
                <Badge name={p.team_a} large />
                <h2>{p.team_a}</h2>
                <small>TEAM A</small>
              </div>
              <span className="versus">VS</span>
              <div>
                <Badge name={p.team_b} large />
                <h2>{p.team_b}</h2>
                <small>TEAM B</small>
              </div>
            </div>
            <ProbabilityBar prediction={p} />
            <div className="forecast-assumptions">
              <h3>The information set</h3>
              <p>
                Both teams are compared using only completed matches observed before the feature
                cutoff. The language model explains this output; it does not calculate the
                prediction.
              </p>
              <div className="feature-grid">
                {[
                  ['elo_a', 'Team A Elo'],
                  ['elo_b', 'Team B Elo'],
                  ['recent_form_a', 'Team A recent form'],
                  ['recent_form_b', 'Team B recent form'],
                  ['historical_matches_a', 'Team A history'],
                  ['historical_matches_b', 'Team B history'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <b>
                      {String(p.evidence[key] ?? 'Unavailable')}
                      {key.includes('history') ? '' : ''}
                    </b>
                  </div>
                ))}
              </div>
            </div>
            <dl className="provenance-list">
              <div>
                <dt>Model</dt>
                <dd>{p.model}</dd>
              </div>
              <div>
                <dt>Evidence cutoff</dt>
                <dd>{date(p.as_of, true)}</dd>
              </div>
              <div>
                <dt>Match ID</dt>
                <dd className="mono">{p.match_id}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>predictions.json · {p.data_kind}</dd>
              </div>
            </dl>
            <button
              className="button button-primary wide"
              onClick={() =>
                ask(`Explain the stored forecast probabilities and limitations for ${p.match_id}.`)
              }
            >
              <Sparkles size={17} /> Explain this forecast <ArrowRight size={17} />
            </button>
            <p className="small muted">
              {p.limitations}. Point-in-time availability limits what can be inferred.
            </p>
          </section>
        </div>
      ) : (
        <Empty>
          No eligible predictions exist for this sport. Collect enough point-in-time history before
          training.
        </Empty>
      )}
    </>
  )
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}

function TeamExplorer({
  data,
  sport,
  ask,
  initialTeam,
}: {
  data: Snapshot
  sport: Sport
  ask: (question: string) => void
  initialTeam?: string
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(''),
    [sort, setSort] = useState('win_rate')
  useEffect(() => {
    if (initialTeam) {
      const candidates = data.teams.filter(
        (t) => t.sport === sport && (t.team_id === initialTeam || t.team_name === initialTeam),
      )
      const team = candidates.length === 1 ? candidates[0] : undefined
      setSelected(team?.team_id || '')
      setQuery('')
    }
  }, [initialTeam, sport, data])
  const all = data.teams.filter((t) => t.sport === sport)
  const visible = all
    .filter((t) => t.team_name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === 'name'
        ? a.team_name.localeCompare(b.team_name)
        : sort === 'wins'
          ? b.wins - a.wins
          : b.win_rate - a.win_rate,
    )
  const team = all.find((t) => t.team_id === selected) || visible[0]
  const matches = team
    ? data.matches
        .filter(
          (m) =>
            m.sport === sport &&
            teamSide(
              m,
              {
                team_id: team.team_id,
                team_key: team.team_id,
                team_name: team.team_name,
                identity_source: 'match',
              },
              data,
            ) !== undefined,
        )
        .sort((a, b) => b.start_time.localeCompare(a.start_time))
    : []
  const completed = matches.filter((m) => m.status === 'finished')
  const form = completed
    .slice(0, 8)
    .reverse()
    .map((m) => {
      const a =
        teamSide(
          m,
          {
            team_id: team!.team_id,
            team_key: team!.team_id,
            team_name: team!.team_name,
            identity_source: 'match',
          },
          data,
        ) === 'a'
      const scored = a ? m.score_a! : m.score_b!
      const conceded = a ? m.score_b! : m.score_a!
      return scored === conceded ? 'D' : scored > conceded ? 'W' : 'L'
    })
  return (
    <>
      <PageHeading
        eyebrow="FORM, IN CONTEXT"
        title="Know your team."
        description={`Explore completed ${sport === 'football' ? 'football matches and goal' : 'VALORANT series and map'} statistics without mixing the two sports.`}
      />
      <div className="team-workspace">
        <section className="team-list panel">
          <div className="input-icon">
            <Search size={17} />
            <input
              aria-label="Search teams"
              placeholder="Search teams…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected('')
              }}
            />
          </div>
          <div className="team-list-toolbar">
            <span>{visible.length} teams</span>
            <label>
              <span className="sr-only">Sort teams</span>
              <select
                aria-label="Sort teams"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="win_rate">Win rate</option>
                <option value="wins">Total wins</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>
          </div>
          {visible.map((t) => (
            <button
              key={t.team_id}
              className={`team-option ${team?.team_id === t.team_id ? 'selected' : ''}`}
              aria-pressed={team?.team_id === t.team_id}
              onClick={() => setSelected(t.team_id)}
            >
              <Badge name={t.team_name} />
              <span>
                <b>{t.team_name}</b>
                <small>{t.matches} completed matches</small>
              </span>
              <strong>{pct(t.win_rate)}</strong>
            </button>
          ))}
          {!visible.length && <Empty>No teams match “{query}”.</Empty>}
        </section>
        <section className="team-detail">
          {team ? (
            <>
              <div className="panel team-profile">
                <div className="team-profile-heading">
                  <Badge name={team.team_name} large />
                  <div>
                    <span className="eyebrow">{sport.toUpperCase()} · TEAM PROFILE</span>
                    <h2>{team.team_name}</h2>
                    <p>
                      {team.matches} completed matches · last result {date(team.last_match_at)}
                    </p>
                  </div>
                </div>
                <div className="team-stat-grid">
                  <Stat
                    label="Win rate"
                    value={pct(team.win_rate, 1)}
                    sub={`${team.wins} wins in ${team.matches} matches`}
                  />
                  <Stat
                    label={sport === 'football' ? 'Goal difference' : 'Map difference'}
                    value={`${team.score_for - team.score_against > 0 ? '+' : ''}${team.score_for - team.score_against}`}
                    sub={`${team.score_for} for · ${team.score_against} against`}
                  />
                  <Stat
                    label="Record"
                    value={`${team.wins} / ${team.draws} / ${team.losses}`}
                    sub="Wins / draws / losses"
                  />
                </div>
                <div className="recent-form">
                  <div>
                    <span className="eyebrow">LAST EIGHT RESULTS</span>
                    <p>
                      Oldest <ArrowRight size={13} /> newest
                    </p>
                  </div>
                  <div
                    className="form-dots"
                    aria-label={`Recent form oldest to newest: ${form.join(', ')}`}
                  >
                    {form.map((result, i) => (
                      <span className={`form-dot form-${result}`} key={i}>
                        {result}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    ask(`What are the statistics and limitations for ${team.team_name}?`)
                  }
                >
                  Ask Arena about {team.team_name} <ArrowUpRight size={16} />
                </button>
              </div>
              <section className="panel">
                <SectionTitle
                  title="Match history"
                  aside={<span className="pill">Latest 10</span>}
                />
                <MatchTable matches={matches.slice(0, 10)} />
              </section>
            </>
          ) : (
            <Empty>Select a team with recorded match history.</Empty>
          )}
        </section>
      </div>
    </>
  )
}

type ChatMessage = { question: string; response?: ChatResponse; error?: string; rated?: number }
function Chat({
  data,
  sport,
  connection,
  initialQuestion,
  clearQuestion,
  showSource,
}: {
  data: Snapshot
  sport: Sport
  connection: Connection
  initialQuestion: string
  clearQuestion: () => void
  showSource: (source: string, evidence?: unknown) => void
}) {
  const [question, setQuestion] = useState(initialQuestion),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [busy, setBusy] = useState(false),
    [ai, setAi] = useState(false),
    [hybrid, setHybrid] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (initialQuestion) {
      setQuestion(initialQuestion)
      clearQuestion()
    }
  }, [initialQuestion, clearQuestion])
  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [messages.length])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || busy) return
    const text = question.trim()
    setQuestion('')
    setBusy(true)
    setFeedbackError('')
    setMessages((old) => [...old, { question: text }])
    try {
      const response =
        connection === 'snapshot'
          ? staticAnswer(text, data, sport)
          : await sendChat(text, ai ? 'ollama' : 'evidence', hybrid ? 'hybrid' : 'lexical')
      setMessages((old) => old.map((m, i) => (i === old.length - 1 ? { ...m, response } : m)))
    } catch (error) {
      setMessages((old) =>
        old.map((m, i) =>
          i === old.length - 1
            ? {
                ...m,
                error: error instanceof Error ? error.message : 'The request failed. Please retry.',
              }
            : m,
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  async function rate(index: number, rating: number) {
    const response = messages[index].response
    if (!response) return
    try {
      await feedback(response.trace_id, rating)
      setMessages((old) => old.map((m, i) => (i === index ? { ...m, rated: rating } : m)))
    } catch {
      setFeedbackError('Feedback could not be saved. Please retry when the local API is available.')
    }
  }
  const prediction = data.predictions.find((p) => p.sport === sport)
  const prompts = [
    prediction
      ? `Explain the stored forecast probabilities for ${prediction.match_id}.`
      : 'What features are used for predictions?',
    `What are the statistics for ${data.teams.find((t) => t.sport === sport)?.team_name || 'this team'}?`,
    'Which data quality incidents are open?',
    'Explain the data lineage.',
  ]
  return (
    <>
      <PageHeading
        eyebrow="THE EVIDENCE COMES FIRST"
        title="Ask a better question."
        description="Your research partner for match data, model assumptions and pipeline health."
      />
      <section className="chat-layout">
        <div className="chat-main panel">
          <div className="chat-toolbar">
            <span>
              <Bot size={19} />
              <b>Arena Copilot</b>
              <span className="pill">
                {connection === 'snapshot'
                  ? 'Snapshot evidence'
                  : ai
                    ? 'Local Qwen3'
                    : 'Evidence browser'}
              </span>
            </span>
            <button
              className="text-button"
              disabled={busy || !messages.length}
              onClick={() => setMessages([])}
            >
              Clear conversation
            </button>
          </div>
          <div className="chat-content">
            {!messages.length && (
              <div className="chat-welcome">
                <span className="copilot-emblem">
                  <Sparkles size={30} />
                </span>
                <h2>Let’s connect the dots.</h2>
                <p>
                  Try a precise question. Every answer carries its dataset version, source and
                  evidence.
                </p>
                <div className="prompt-grid">
                  {prompts.map((prompt, i) => (
                    <button key={prompt} onClick={() => setQuestion(prompt)}>
                      <span>
                        {
                          [
                            'Understand a forecast',
                            'Explore team form',
                            'Inspect data quality',
                            'Follow the lineage',
                          ][i]
                        }
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <article className="chat-turn" key={index}>
                <div className="user-question">
                  <span className="eyebrow">YOU</span>
                  <p>{message.question}</p>
                </div>
                <div className="assistant-response">
                  <div className="assistant-label">
                    <span>
                      <Sparkles size={15} /> ARENA
                    </span>
                    {message.response && (
                      <span>
                        {message.response.abstained
                          ? 'Insufficient or ambiguous evidence'
                          : 'Evidence returned'}
                      </span>
                    )}
                  </div>
                  {message.error ? (
                    <div role="alert" className="notice notice-error">
                      {message.error}
                    </div>
                  ) : message.response ? (
                    <>
                      <p className="answer-text">{message.response.answer}</p>
                      <div className="source-chips">
                        {message.response.citations.map((source, i) => (
                          <button
                            key={source.id || i}
                            onClick={() => {
                              const name = source.source || source.id || ''
                              const tools = (
                                message.response?.tools ||
                                message.response?.evidence ||
                                []
                              ).filter((tool) => tool.source === name)
                              showSource(name, tools.length ? tools : undefined)
                            }}
                          >
                            <FileText size={12} />
                            {source.source || source.id || source.title || 'Source'}
                          </button>
                        ))}
                      </div>
                      {!!(message.response.tools || message.response.evidence)?.length && (
                        <details className="tool-evidence">
                          <summary>
                            <GitBranch size={13} /> Inspect tool evidence <ChevronDown size={13} />
                          </summary>
                          <pre>
                            {JSON.stringify(
                              message.response.tools || message.response.evidence,
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                      <div className="trace-line">
                        <span>
                          {message.response.mode === 'snapshot_evidence'
                            ? 'Browser evidence · no model called'
                            : message.response.model
                              ? `${message.response.model} · local generation`
                              : 'Deterministic evidence · no model called'}
                        </span>
                        <code>{message.response.trace_id.slice(0, 18)}…</code>
                        {connection === 'local' && (
                          <span className="feedback-buttons">
                            <button
                              aria-label="Helpful answer"
                              disabled={message.rated !== undefined}
                              onClick={() => rate(index, 1)}
                            >
                              {message.rated === 1 ? <Check size={14} /> : <ThumbsUp size={14} />}
                            </button>
                            <button
                              aria-label="Unhelpful answer"
                              disabled={message.rated !== undefined}
                              onClick={() => rate(index, -1)}
                            >
                              {message.rated === -1 ? (
                                <Check size={14} />
                              ) : (
                                <ThumbsDown size={14} />
                              )}
                            </button>
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="thinking" role="status">
                      <span className="loading-ring" />
                      {ai
                        ? 'Reading evidence and generating locally. CPU inference may take several minutes…'
                        : 'Reading the snapshot…'}
                    </div>
                  )}
                </div>
              </article>
            ))}
            <div ref={bottom} />
          </div>
          {feedbackError && (
            <p role="alert" className="error-text">
              {feedbackError}
            </p>
          )}
          <form onSubmit={submit} className="chat-composer">
            <label className="sr-only" htmlFor="arena-question">
              Your question
            </label>
            <textarea
              id="arena-question"
              aria-label="Your question"
              placeholder="Ask about a team, a forecast or the data…"
              value={question}
              maxLength={2000}
              rows={2}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
            />
            <div className="composer-bottom">
              <span>
                {connection === 'snapshot'
                  ? 'Read-only public snapshot. No API key needed.'
                  : ai
                    ? 'Local model · 4,096-token context · max 6 tool calls'
                    : 'Read-only evidence tools. No inference.'}
              </span>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy || !question.trim()}
              >
                {busy ? 'Working…' : 'Ask Arena'}
                <Send size={15} />
              </button>
            </div>
          </form>
        </div>
        <aside className="chat-aside">
          <section className="panel">
            <SectionTitle title="Your workspace" />
            <div className="workspace-mode">
              <label>
                <input
                  type="checkbox"
                  aria-label="Local AI"
                  checked={ai}
                  disabled={connection !== 'local' || busy}
                  onChange={(e) => setAi(e.target.checked)}
                />
                <span>
                  Local AI <small>Qwen3:4b via Ollama</small>
                </span>
              </label>
              <p>
                {connection === 'snapshot'
                  ? 'Connect the local FastAPI server and Ollama to enable generative explanations. The public site browses stored evidence.'
                  : 'Generation stays on your machine. The model can explain stored forecasts, never invent new probabilities.'}
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label="Hybrid retrieval"
                  checked={hybrid}
                  disabled={connection !== 'local' || busy}
                  onChange={(e) => setHybrid(e.target.checked)}
                />
                <span>
                  Hybrid retrieval <small>Lexical + Nomic embeddings</small>
                </span>
              </label>
              <p>
                Hybrid retrieval requires the local embedding index. Lexical retrieval is the
                default.
              </p>
            </div>
          </section>
          <section className="panel evidence-contract">
            <ShieldCheck size={25} />
            <h3>Answers with a paper trail.</h3>
            <ul>
              <li>Sources you can inspect</li>
              <li>Read-only, bounded tools</li>
              <li>Visible model & trace IDs</li>
              <li>Explicit uncertainty</li>
            </ul>
            <dl>
              <dt>Dataset</dt>
              <dd className="mono">{data.manifest.dataset_version}</dd>
              <dt>Evidence as of</dt>
              <dd>{date(data.manifest.as_of, true)}</dd>
            </dl>
          </section>
        </aside>
      </section>
    </>
  )
}

function ModelReport({ card, sport }: { card?: ModelCard; sport: Sport }) {
  if (!card?.test)
    return <Empty>{card?.reason || 'Model evaluation is unavailable for this sport.'}</Empty>
  const model = card.test.model,
    baseline = card.test.frequency_baseline
  return (
    <>
      <div className="model-head">
        <span className="pill">{sport.toUpperCase()}</span>
        <span className="mono small">{card.model}</span>
      </div>
      <div className="table-scroll">
        <table className="model-table">
          <thead>
            <tr>
              <th scope="col">Test metric</th>
              <th scope="col">Model</th>
              <th scope="col">Frequency baseline</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Accuracy ↑</th>
              <td>{pct(model.accuracy, 1)}</td>
              <td>{pct(baseline.accuracy, 1)}</td>
            </tr>
            <tr>
              <th scope="row">Log loss ↓</th>
              <td>{model.log_loss.toFixed(3)}</td>
              <td>{baseline.log_loss.toFixed(3)}</td>
            </tr>
            <tr>
              <th scope="row">Brier score ↓</th>
              <td>{model.multiclass_brier.toFixed(3)}</td>
              <td>{baseline.multiclass_brier.toFixed(3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="model-reading">
        <Activity size={18} />
        <p>
          {model.log_loss < baseline.log_loss
            ? `The model improves test log loss against the baseline on this ${card.data_kind === 'api' ? 'API-data' : 'synthetic'} split.`
            : 'The baseline has better test log loss. A higher accuracy alone does not mean better probability estimates.'}{' '}
          <b>Neither result validates real-world performance.</b>
        </p>
      </div>
      <dl className="provenance-list">
        <div>
          <dt>Training / test</dt>
          <dd>
            {card.train_samples} / {model.samples} samples
          </dd>
        </div>
        <div>
          <dt>Split</dt>
          <dd>{card.split}</dd>
        </div>
        <div>
          <dt>Calibration</dt>
          <dd>{card.calibration}</dd>
        </div>
        <div>
          <dt>Features</dt>
          <dd>{card.feature_names?.join(', ')}</dd>
        </div>
      </dl>
    </>
  )
}
function QualityView({
  data,
  sport,
  showSource,
}: {
  data: Snapshot
  sport: Sport
  showSource: (source: string) => void
}) {
  const { summary } = data.quality
  const total = summary.valid_events + summary.quarantined
  return (
    <>
      <PageHeading
        eyebrow="TRUST IS A SYSTEM PROPERTY"
        title="See how it holds up."
        description="Quality checks, honest model comparisons and a path back to the source."
      />
      <div className="quality-grid">
        <section className="panel quality-panel">
          <SectionTitle
            title="Dataset health"
            aside={
              <span className="pill pill-green">
                <CheckCircle2 size={12} />
                {summary.last_run_status}
              </span>
            }
          />
          <div className="quality-large-number">
            <strong>{total ? pct(summary.valid_events / total, 2) : '—'}</strong>
            <span>accepted observations</span>
          </div>
          <div className="quality-track">
            <span style={{ width: `${total ? (summary.valid_events / total) * 100 : 0}%` }} />
          </div>
          <div className="quality-totals">
            <span>
              <b>{summary.valid_events.toLocaleString()}</b> Valid
            </span>
            <span>
              <b>{summary.quarantined}</b> Quarantined
            </span>
            <span>
              <b>{data.incidents.length}</b> Incidents
            </span>
          </div>
          <div className="quality-checks">
            {data.quality.checks.map((check, index) => (
              <div key={index}>
                <ShieldCheck size={17} />
                <span>
                  <b>{check.rule.replaceAll('_', ' ')}</b>
                  <small>
                    {check.table} · {check.passed.toLocaleString()} passed, {check.failed} failed
                  </small>
                </span>
                <span className={`status ${check.failed ? 'status-warning' : 'status-finished'}`}>
                  {check.failed ? 'Warning' : 'Passed'}
                </span>
              </div>
            ))}
          </div>
          <p className="small muted">
            Quarantine protects downstream statistics. A successful run can still contain rejected
            observations that require review.
          </p>
        </section>
        <section className="panel">
          <SectionTitle title="Model report" aside={<span className="pill">Held-out test</span>} />
          <ModelReport card={data.model_report.sports[sport]} sport={sport} />
        </section>
      </div>
      <section className="panel incidents-panel">
        <SectionTitle
          eyebrow="OPERATIONS LOG"
          title="Recorded incidents"
          aside={<span className="count-badge">{data.incidents.length}</span>}
        />
        {data.incidents.map((incident) => (
          <div className="incident" key={incident.incident_id}>
            <span className="incident-symbol">
              <Flag size={19} />
            </span>
            <div>
              <div className="incident-heading">
                <h3>{incident.description}</h3>
                <span className="status status-warning">{incident.status}</span>
              </div>
              <p>
                {incident.table} · {incident.rule.replaceAll('_', ' ')} · {incident.severity}
              </p>
              <div className="remediation">
                <span>RECOMMENDED ACTION</span>
                <p>
                  {incident.remediation}. Recommendations are reviewable; the copilot cannot modify
                  source data.
                </p>
              </div>
            </div>
          </div>
        ))}
        {!data.incidents.length && <Empty>No incidents are recorded in this snapshot.</Empty>}
      </section>
      <section className="panel lineage-panel">
        <SectionTitle
          eyebrow="FOLLOW THE DATA"
          title="From observation to explanation"
          aside={<GitBranch size={19} />}
        />
        <div className="lineage-steps">
          {['Provider / replay', 'Bronze events', 'Canonical matches', 'Team statistics'].map(
            (step, i) => (
              <div key={step}>
                <span>0{i + 1}</span>
                <b>{step}</b>
                {i < 3 && <ArrowRight size={19} />}
              </div>
            ),
          )}
        </div>
        <div className="lineage-details">
          {data.lineage.map((line, i) => (
            <p key={i}>
              <code>{line.source}</code>
              <ArrowRight size={13} />
              <code>{line.target}</code>
              <span>{line.transformation}</span>
            </p>
          ))}
        </div>
      </section>
      <div className="document-grid">
        {data.documents.map((document) => (
          <button
            className="document-card"
            key={document.id}
            onClick={() => showSource(document.id)}
          >
            <FileText size={23} />
            <h3>{document.title}</h3>
            <span>
              {document.id}
              <ArrowUpRight size={16} />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function SourceModal({
  source,
  data,
  close,
  evidence,
}: {
  source: string
  data: Snapshot
  close: () => void
  evidence?: unknown
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      if (d?.open) d.close()
    }
  }, [])
  const document: Document | undefined = data.documents.find(
    (d) => d.id === source || `docs/${d.id}` === source,
  )
  const payload =
    evidence ??
    (source.includes('match_history')
      ? data.match_history
      : source.includes('predictions')
        ? data.predictions
        : source.includes('incidents')
          ? data.incidents
          : source.includes('quality')
            ? data.quality
            : source.includes('lineage')
              ? data.lineage
              : source.includes('catalog')
                ? data.catalog
                : source.includes('team_stats')
                  ? data.teams
                  : source.includes('matches')
                    ? data.matches.slice(0, 30)
                    : null)
  return (
    <dialog
      ref={dialog}
      className="source-dialog"
      aria-labelledby="source-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="source-dialog-header">
        <div>
          <span className="eyebrow">SNAPSHOT EVIDENCE</span>
          <h2 id="source-title">{document?.title || source || 'Source'}</h2>
        </div>
        <button className="icon-button" onClick={close} aria-label="Close source">
          <X size={21} />
        </button>
      </div>
      <p className="source-version">
        Dataset {data.manifest.dataset_version} · {data.manifest.data_kind} · As of{' '}
        {date(data.manifest.as_of, true)}
      </p>
      <div className="source-dialog-body">
        {evidence !== undefined && (
          <p className="source-version">
            Returned tool evidence for this answer, reconstructed from the cited source.
          </p>
        )}
        {document ? (
          <p className="document-text">{document.text}</p>
        ) : payload ? (
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        ) : (
          <p>
            This source is not present in the published document set. Inspect the returned
            structured tool evidence in the conversation.
          </p>
        )}
      </div>
    </dialog>
  )
}

interface Navigation {
  view: View
  sport: Sport
  competition: string
  match: string
  team: string
  research_edition: string
  research_match: string
  research_team: string
  research_section: string
  research_team_filter: string
  research_search: string
  research_region: string
  research_date: string
  research_status: OpenFootballFilters['status']
  research_group: string
  research_round: string
  live_provider: LiveProvider
  live_status: LiveFilterStatus
  live_search: string
  live_page: string
  live_match: string
  live_tab: 'matches' | 'events'
  live_event: string
  live_from: string
  live_to: string
  live_include_undated: string
  live_workspace: 'directory' | 'canonical'
  live_canonical_fingerprint: string
}
function readNavigation(): Navigation {
  const query = new URLSearchParams(window.location.search),
    requested = query.get('view')
  return {
    view: views.some((v) => v.id === requested) ? (requested as View) : 'overview',
    sport: query.get('sport') === 'valorant' ? 'valorant' : 'football',
    competition: query.get('competition') || '',
    match: query.get('match') || '',
    team: query.get('team') || '',
    research_edition: query.get('research_edition') || '',
    research_match: query.get('research_match') || '',
    research_team: query.get('research_team') || '',
    research_section: query.get('research_section') === 'teams' ? 'teams' : 'matches',
    research_team_filter: query.get('research_team_filter') || '',
    research_search: query.get('research_search') || '',
    research_region: query.get('research_region') || '',
    research_date: /^\d{4}-\d{2}-\d{2}$/.test(query.get('research_date') || '')
      ? query.get('research_date')!
      : '',
    research_status:
      query.get('research_status') === 'all'
        ? 'all'
        : query.get('research_status') === 'unknown_result'
          ? 'unknown_result'
          : query.get('research_status') === 'observed_result'
            ? 'observed_result'
            : query.get('research_team_filter')
              ? 'all'
              : 'observed_result',
    research_group: query.get('research_group') || '',
    research_round: query.get('research_round') || '',
    live_provider: query.get('live_provider') === 'pandascore' ? 'pandascore' : 'football-data',
    live_status: ['scheduled', 'finished', 'cancelled', 'postponed', 'all'].includes(
      query.get('live_status') || '',
    )
      ? (query.get('live_status') as LiveFilterStatus)
      : 'running',
    live_search: (query.get('live_search') || '').slice(0, 100),
    live_page: String(
      Math.max(0, Math.min(4000, Number.parseInt(query.get('live_page') || '0', 10) || 0)),
    ),
    live_match: query.get('live_match') || '',
    live_tab: query.get('live_tab') === 'events' ? 'events' : 'matches',
    live_event: (query.get('live_event') || '').slice(0, 100),
    live_from: (query.get('live_from') || '').slice(0, 20),
    live_to: (query.get('live_to') || '').slice(0, 20),
    live_include_undated: query.get('live_include_undated') === 'false' ? 'false' : 'true',
    live_workspace: query.get('live_workspace') === 'canonical' ? 'canonical' : 'directory',
    live_canonical_fingerprint: (query.get('live_canonical_fingerprint') || '').slice(0, 100),
  }
}

export default function App() {
  const [data, setData] = useState<Snapshot>(),
    [connection, setConnection] = useState<Connection>('snapshot'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  const [route, setRoute] = useState<Navigation>(readNavigation)
  const {
    view,
    sport,
    competition: selectedCompetition,
    match: selectedMatch,
    team: teamFocus,
    research_edition: researchEdition,
    research_match: researchMatch,
    research_team: researchTeam,
    research_section: researchSection,
    research_team_filter: researchTeamFilter,
  } = route
  const isOpenFootball = view === 'open-football'
  const isLive = view === 'live'
  const publishedDisplayProfile =
    import.meta.env.VITE_STATIC_DEMO === 'true' &&
    import.meta.env.VITE_PUBLISHED_CURRENT_DATA === 'true'
  const [liveRefresh, setLiveRefresh] = useState(0)
  const research = useOpenFootballData(isOpenFootball)
  const [question, setQuestion] = useState(''),
    [source, setSource] = useState(''),
    [sourceEvidence, setSourceEvidence] = useState<unknown>(),
    [menu, setMenu] = useState(false)
  function showSource(name: string, evidence?: unknown) {
    setSourceEvidence(evidence)
    setSource(name)
  }
  const competitionData = useCompetitions(data, connection, sport)
  const navigation = views.map((v) =>
    v.id === 'events' ? { ...v, label: sport === 'football' ? 'Competitions' : 'Events' } : v,
  )
  const [mobile, setMobile] = useState(window.matchMedia('(max-width:760px)').matches)
  const sidebar = useRef<HTMLElement>(null),
    main = useRef<HTMLElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const query = window.matchMedia('(max-width:760px)')
    const update = () => {
      setMobile(query.matches)
      if (!query.matches) setMenu(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  function closeMenu() {
    setMenu(false)
    window.requestAnimationFrame(() => menuTrigger.current?.focus())
  }
  useEffect(() => {
    if (!menu || !mobile) return
    const controls = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') || [],
      )
    controls()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
      if (event.key === 'Tab') {
        const all = controls(),
          first = all[0],
          last = all[all.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [menu, mobile])
  async function reloadSynthetic() {
    setLoading(true)
    setError('')
    try {
      const result = await loadData()
      setData(result.snapshot)
      setConnection(result.connection)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the dataset.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!isOpenFootball && !isLive && !data) void reloadSynthetic()
  }, [isOpenFootball, isLive])
  function reload() {
    if (isLive) setLiveRefresh((current) => current + 1)
    else if (isOpenFootball) void research.reload()
    else void reloadSynthetic()
  }
  useEffect(() => {
    const pop = () => {
      setRoute(readNavigation())
      setMenu(false)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  function updateRoute(change: Partial<Navigation>, replace = false, matchOpened = false) {
    const next = { ...route, ...change },
      url = new URL(window.location.href)
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    window.history[replace ? 'replaceState' : 'pushState'](
      { arena: true, arenaMatch: matchOpened },
      '',
      url,
    )
    setRoute(next)
    setMenu(false)
  }
  function navigate(next: View) {
    updateRoute({ view: next, match: '', research_match: '', live_match: '' })
    window.scrollTo({ top: 0, behavior: 'instant' })
    window.requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }
  function openMatch(id: string) {
    updateRoute({ match: id }, false, true)
  }
  function closeMatch() {
    if (window.history.state?.arenaMatch) {
      window.history.back()
    } else updateRoute({ match: '' }, true)
  }
  function openResearchMatch(id: string) {
    updateRoute({ research_match: id, match: '' }, false, true)
  }
  function closeResearchMatch() {
    if (window.history.state?.arenaMatch) window.history.back()
    else updateRoute({ research_match: '' }, true)
  }
  function openEvent(id: string) {
    updateRoute({ view: 'events', competition: id, match: '' })
    window.scrollTo({ top: 0 })
  }
  function openTeam(name: string, key?: string) {
    updateRoute({ view: 'teams', team: key || name, match: '' })
    window.scrollTo({ top: 0 })
  }
  function changeSport(next: Sport) {
    updateRoute({ sport: next, competition: '', match: '', team: '' })
  }
  function ask(text: string) {
    setQuestion(text)
    navigate('copilot')
  }
  return (
    <div
      className="app"
      data-sport={
        isLive
          ? route.live_provider === 'pandascore'
            ? 'valorant'
            : 'football'
          : isOpenFootball
            ? 'football'
            : sport
      }
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside ref={sidebar} className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <button
          className="icon-button sidebar-close"
          onClick={closeMenu}
          aria-label="Close navigation menu"
        >
          <X size={19} />
        </button>
        <button className="brand" onClick={() => navigate('overview')} aria-label="Arena home">
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            arena<small>THE INTELLIGENCE LAB</small>
          </span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${view === id ? 'active' : ''}`}
              key={id}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'copilot' && <span className="nav-new">AI</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-lab">
          <div className="lab-top">
            <span className="signal-dot" /> OPEN RESEARCH PROJECT
          </div>
          <h3>Built to be inspected.</h3>
          <p>
            A lakehouse and a copilot.
            <br />
            One connected evidence trail.
          </p>
          <a href="https://github.com/Manuelma4/lakehouse-copilot" target="_blank" rel="noreferrer">
            Explore the source <ArrowUpRight size={15} />
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </div>
        <div className="sidebar-bottom">
          <div className="author-avatar">MM</div>
          <div>
            <b>Manuel Maya</b>
            <span>Data engineering & AI</span>
          </div>
          <a
            href="https://manuelma4.github.io/"
            target="_blank"
            rel="noreferrer"
            aria-label="Manuel Maya portfolio (opens in new tab)"
          >
            <ExternalLink size={15} />
          </a>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-backdrop"
          tabIndex={-1}
          onClick={closeMenu}
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell" inert={menu && mobile}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menuTrigger}
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label={menu ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menu}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />
              <b>{navigation.find((v) => v.id === view)?.label}</b>
            </span>
          </div>
          <div className="topbar-controls">
            {isLive ? (
              <span className="of-mode-label">
                <Activity size={14} />{' '}
                {publishedDisplayProfile ? 'Provider fixtures' : 'Polled provider data'}
              </span>
            ) : isOpenFootball ? (
              <span className="of-mode-label">
                <Globe2 size={14} /> Open data research
              </span>
            ) : (
              <div className="sport-selector" role="group" aria-label="Select sport">
                <button
                  aria-pressed={sport === 'football'}
                  className={sport === 'football' ? 'selected' : ''}
                  onClick={() => changeSport('football')}
                >
                  <span className="sport-dot football-dot" />
                  Football
                </button>
                <button
                  aria-pressed={sport === 'valorant'}
                  className={sport === 'valorant' ? 'selected' : ''}
                  onClick={() => changeSport('valorant')}
                >
                  <span className="sport-dot valorant-dot" />
                  VALORANT
                </button>
              </div>
            )}
            <button
              className="icon-button refresh-button"
              onClick={reload}
              disabled={
                isLive
                  ? import.meta.env.VITE_STATIC_DEMO === 'true' && !publishedDisplayProfile
                  : isOpenFootball
                    ? research.loading
                    : loading
              }
              aria-label={
                isLive
                  ? 'Refresh current provider'
                  : isOpenFootball
                    ? 'Refresh OpenFootball sources'
                    : 'Refresh dataset'
              }
            >
              <RefreshCw
                size={17}
                className={!isLive && (isOpenFootball ? research.loading : loading) ? 'spin' : ''}
              />
            </button>
          </div>
        </header>
        <main ref={main} id="main-content" tabIndex={-1}>
          {isLive ? (
            <div className="dataset-banner">
              <div>
                <span className="connection-dot" />
                <b>
                  {publishedDisplayProfile
                    ? 'Fixtures & results'
                    : import.meta.env.VITE_STATIC_DEMO === 'true'
                      ? 'Live backend not connected'
                      : 'Local provider transport'}
                </b>
                <span className="banner-divider">/</span>
                <span>Current data · separate from stored research</span>
              </div>
            </div>
          ) : isOpenFootball ? (
            <div className="dataset-banner">
              <div>
                <span
                  className={`connection-dot ${research.connection === 'local' ? 'is-local' : ''}`}
                />
                <b>
                  {research.connection === 'local'
                    ? 'Local source package'
                    : 'Published source package'}
                </b>
                <span className="banner-divider">/</span>
                <span>OpenFootball · CC0-1.0</span>
              </div>
              <span>
                {research.data
                  ? `Collected as of ${date(research.data.manifest.as_of, true)}`
                  : research.error
                    ? 'Source package unavailable'
                    : 'Loading community source records…'}
              </span>
            </div>
          ) : (
            <div className="dataset-banner">
              <div>
                <span className={`connection-dot ${connection === 'local' ? 'is-local' : ''}`} />
                <b>{connection === 'local' ? 'Local workspace' : 'Public snapshot'}</b>
                <span className="banner-divider">/</span>
                <span>
                  {data?.manifest.data_kind === 'api' ? 'API dataset' : 'Synthetic demonstration'}
                </span>
              </div>
              <span>
                {data ? `Evidence as of ${date(data.manifest.as_of, true)}` : 'Loading evidence…'}
              </span>
            </div>
          )}
          {!isOpenFootball &&
            !isLive &&
            data &&
            (data.match_total ?? data.matches.length) > data.matches.length && (
              <div className="notice notice-subtle">
                <CircleHelp size={16} />
                <span>
                  Showing the latest {data.matches.length.toLocaleString()} of{' '}
                  {data.match_total?.toLocaleString()} matches. Overview totals and team aggregates
                  cover the complete dataset; visible history and recent form cover only loaded
                  matches.
                </span>
              </div>
            )}
          {isLive ? (
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  <span className="loading-ring" />
                  <p>Opening current provider matches…</p>
                </div>
              }
            >
              <LiveWorkspace
                provider={route.live_provider}
                filters={{
                  status: route.live_status,
                  search: route.live_search,
                  page: Number(route.live_page),
                  tab: route.live_tab,
                  event: route.live_event,
                  from: route.live_from,
                  through: route.live_to,
                  includeUnresolved: route.live_include_undated !== 'false',
                  workspace: route.live_workspace,
                }}
                selectedMatch={route.live_match}
                expectedCanonicalFingerprint={route.live_canonical_fingerprint}
                refresh={liveRefresh}
                setProvider={(provider) =>
                  updateRoute({
                    live_provider: provider,
                    live_status: 'running',
                    live_search: '',
                    live_page: '0',
                    live_match: '',
                    live_event: '',
                    live_canonical_fingerprint: '',
                  })
                }
                setFilters={(change, replace = false) =>
                  updateRoute(
                    {
                      ...(change.status !== undefined ? { live_status: change.status } : {}),
                      ...(change.search !== undefined ? { live_search: change.search } : {}),
                      ...(change.page !== undefined ? { live_page: String(change.page) } : {}),
                      ...(change.tab !== undefined ? { live_tab: change.tab } : {}),
                      ...(change.event !== undefined ? { live_event: change.event } : {}),
                      ...(change.from !== undefined ? { live_from: change.from } : {}),
                      ...(change.through !== undefined ? { live_to: change.through } : {}),
                      ...(change.includeUnresolved !== undefined
                        ? { live_include_undated: String(change.includeUnresolved) }
                        : {}),
                      ...(change.workspace !== undefined
                        ? { live_workspace: change.workspace }
                        : {}),
                      live_match: '',
                      live_canonical_fingerprint: '',
                    },
                    replace,
                  )
                }
                openMatch={(id) =>
                  updateRoute({ live_match: id, live_canonical_fingerprint: '' }, false, true)
                }
                openCanonical={
                  import.meta.env.VITE_STATIC_DEMO === 'true'
                    ? undefined
                    : (id, fingerprint) =>
                        updateRoute(
                          {
                            live_workspace: 'canonical',
                            live_match: id,
                            live_canonical_fingerprint: fingerprint,
                          },
                          false,
                          true,
                        )
                }
                closeMatch={() =>
                  window.history.state?.arenaMatch
                    ? window.history.back()
                    : updateRoute({ live_match: '' }, true)
                }
              />
            </Suspense>
          ) : isOpenFootball ? (
            <>
              {research.transportNote && (
                <div className="notice notice-subtle">
                  <CircleHelp size={16} />
                  <span>{research.transportNote}</span>
                </div>
              )}
              {research.loading && !research.data ? (
                <div className="page-loading" role="status">
                  <span className="loading-ring" />
                  <h1>Reading open source records.</h1>
                  <p>Loading the verified OpenFootball research package…</p>
                </div>
              ) : research.error ? (
                <div className="page-error" role="alert">
                  <Globe2 size={36} />
                  <h1>OpenFootball sources are unavailable.</h1>
                  <p>{research.error}</p>
                  <p>No source results or forecasts have been substituted.</p>
                  <button className="button button-primary" onClick={() => void research.reload()}>
                    Retry source package
                    <RefreshCw size={16} />
                  </button>
                </div>
              ) : research.data ? (
                <>
                  <Suspense
                    fallback={
                      <div className="page-loading" role="status">
                        <span className="loading-ring" />
                        <p>Opening the source research workspace…</p>
                      </div>
                    }
                  >
                    <OpenFootballWorkspace
                      connection={research.connection}
                      data={research.data}
                      selectedEdition={researchEdition}
                      selectedMatch={researchMatch}
                      selectedTeam={researchTeam}
                      section={researchSection}
                      teamFilter={researchTeamFilter}
                      filters={{
                        search: route.research_search,
                        region: route.research_region,
                        day: route.research_date,
                        status: route.research_status,
                        group: route.research_group,
                        round: route.research_round,
                      }}
                      setFilters={(change, replace = false) => {
                        const fields = {
                          search: 'research_search',
                          region: 'research_region',
                          day: 'research_date',
                          status: 'research_status',
                          group: 'research_group',
                          round: 'research_round',
                        } as const
                        const next: Partial<Navigation> = {}
                        for (const key of Object.keys(change) as (keyof OpenFootballFilters)[]) {
                          Object.assign(next, { [fields[key]]: change[key] })
                        }
                        if (
                          change.region &&
                          research.data?.competitions.find(
                            (edition) => edition.edition_id === researchEdition,
                          )?.region !== change.region
                        )
                          next.research_edition = ''
                        updateRoute(next, replace)
                      }}
                      setSection={(next) =>
                        updateRoute({
                          research_section: next,
                          research_team: '',
                          research_match: '',
                        })
                      }
                      openTeam={(id) => {
                        updateRoute({
                          research_team: id,
                          research_section: 'teams',
                          research_match: '',
                          research_team_filter: '',
                        })
                        window.scrollTo({ top: 0, behavior: 'instant' })
                      }}
                      backTeam={() =>
                        updateRoute({
                          research_team: '',
                          research_section: 'teams',
                          research_match: '',
                        })
                      }
                      viewTeamRecords={(id) => {
                        updateRoute({
                          research_team_filter: id,
                          research_team: '',
                          research_edition: '',
                          research_section: 'matches',
                          research_search: '',
                          research_region: '',
                          research_date: '',
                          research_status: 'all',
                          research_group: '',
                          research_round: '',
                        })
                        window.scrollTo({ top: 0, behavior: 'instant' })
                      }}
                      clearTeamFilter={() => updateRoute({ research_team_filter: '' })}
                      resetScope={() =>
                        updateRoute({
                          research_team_filter: '',
                          research_edition: '',
                          research_search: '',
                          research_region: '',
                          research_date: '',
                          research_status: 'observed_result',
                          research_group: '',
                          research_round: '',
                        })
                      }
                      setEdition={(id) =>
                        updateRoute({
                          research_edition: id,
                          research_match: '',
                          research_team: '',
                          research_section: 'matches',
                          research_search: '',
                          research_date: '',
                          research_status: 'observed_result',
                          research_group: '',
                          research_round: '',
                          research_region:
                            route.research_region &&
                            research.data?.competitions.find((edition) => edition.edition_id === id)
                              ?.region !== route.research_region
                              ? ''
                              : route.research_region,
                        })
                      }
                      openMatch={openResearchMatch}
                      closeMatch={closeResearchMatch}
                    />
                  </Suspense>
                  <footer className="footer">
                    <span>
                      <span className="footer-logo">A</span>Arena · OpenFootball research
                    </span>
                    <span>
                      <code>{research.data.manifest.dataset_version}</code>
                      <span className="footer-divider">/</span>CC0-1.0 source data · MIT code
                    </span>
                  </footer>
                </>
              ) : null}
            </>
          ) : loading && !data ? (
            <div className="page-loading" role="status">
              <span className="loading-ring" />
              <h1>Connecting the evidence.</h1>
              <p>Loading the validated match snapshot…</p>
            </div>
          ) : error ? (
            <div className="page-error" role="alert">
              <Database size={36} />
              <h1>The dataset is unavailable.</h1>
              <p>{error}</p>
              <button className="button button-primary" onClick={reload}>
                Try again <RefreshCw size={16} />
              </button>
            </div>
          ) : data ? (
            <>
              {view === 'overview' && (
                <MatchCenter
                  key={sport}
                  data={data}
                  sport={sport}
                  connection={connection}
                  competitions={competitionData.rows}
                  competition={selectedCompetition}
                  setCompetition={(id) => updateRoute({ competition: id })}
                  openMatch={openMatch}
                  openEvent={openEvent}
                  openTeam={openTeam}
                  ask={ask}
                />
              )}
              {view === 'events' && (
                <CompetitionExplorer
                  data={data}
                  sport={sport}
                  connection={connection}
                  competitions={competitionData.rows}
                  selected={selectedCompetition}
                  setSelected={(id) => updateRoute({ competition: id })}
                  openMatch={openMatch}
                  openTeam={openTeam}
                  partial={competitionData.partial}
                />
              )}
              {view === 'forecasts' && <Forecasts data={data} sport={sport} ask={ask} />}
              {view === 'teams' && (
                <TeamExplorer data={data} sport={sport} ask={ask} initialTeam={teamFocus} />
              )}
              {view === 'copilot' && (
                <Chat
                  data={data}
                  sport={sport}
                  connection={connection}
                  initialQuestion={question}
                  clearQuestion={() => setQuestion('')}
                  showSource={showSource}
                />
              )}
              {view === 'quality' && (
                <QualityView data={data} sport={sport} showSource={showSource} />
              )}
              <footer className="footer">
                <span>
                  <span className="footer-logo">A</span> Arena · Evidence over intuition.
                </span>
                <span>
                  <code>{data.manifest.dataset_version}</code>
                  <span className="footer-divider">/</span>MIT-licensed original code
                </span>
              </footer>
            </>
          ) : null}
        </main>
      </div>
      {!isOpenFootball && !isLive && selectedMatch && data && (
        <MatchDetailDrawer
          id={selectedMatch}
          data={data}
          connection={connection}
          competitions={competitionData.rows}
          close={closeMatch}
          openEvent={openEvent}
          openTeam={openTeam}
          ask={ask}
        />
      )}
      {!isOpenFootball && !isLive && source && data && (
        <SourceModal
          source={source}
          data={data}
          evidence={sourceEvidence}
          close={() => setSource('')}
        />
      )}
    </div>
  )
}
