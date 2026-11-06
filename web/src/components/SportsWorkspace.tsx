import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  FileCheck2,
  Flag,
  GitBranch,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react'
import type { Connection, Match, Snapshot, Sport } from '../types'
import {
  deriveCompetitions,
  fetchCompetitionDetail,
  fetchMatchDetail,
  filterMatches,
  getForecast,
  listCompetitions,
  localCompetitionDetail,
  localMatchDetail,
  queryMatches,
} from '../sports'
import type {
  Competition,
  CompetitionDetail,
  MatchDetail,
  MatchFilters,
  Standing,
  TeamForm,
} from '../sports'
import { Badge, date, dayLabel, Empty, pct, ProbabilityBar, time } from './ui'

export function useCompetitions(data: Snapshot | undefined, connection: Connection, sport: Sport) {
  const [rows, setRows] = useState<Competition[]>([]),
    [loading, setLoading] = useState(true),
    [partial, setPartial] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    if (!data) return
    void (async () => {
      const derived = (await deriveCompetitions(data)).filter((c) => c.sport === sport)
      if (!active) return
      setRows(derived)
      setPartial((data.match_total ?? data.matches.length) > data.matches.length)
      if (connection === 'local')
        try {
          const result = await listCompetitions(sport)
          if (active) {
            setRows(result.rows)
            setPartial(result.total > result.rows.length)
          }
        } catch {
          /* Loaded coverage stays visibly bounded. */
        }
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [data, connection, sport])
  return { rows, loading, partial }
}

const competitionStatus = (c: Competition) =>
  c.status === 'ongoing'
    ? 'Results & fixtures'
    : c.status === 'upcoming'
      ? 'Fixtures observed'
      : c.status === 'completed'
        ? 'Results observed'
        : 'Unresolved schedule'
function MatchRows({ rows, openMatch }: { rows: Match[]; openMatch: (id: string) => void }) {
  const groups = new Map<string, Match[]>()
  rows.forEach((m) => {
    const day = new Date(m.start_time).toISOString().slice(0, 10)
    groups.set(day, [...(groups.get(day) || []), m])
  })
  return (
    <div className="match-date-groups">
      {[...groups].map(([day, matches]) => (
        <section className="match-date-group" key={day} aria-label={`Matches on ${day}`}>
          <div className="match-date-heading">
            <h2>{dayLabel(`${day}T00:00:00Z`)}</h2>
            <span>
              {matches.length} {matches.length === 1 ? 'match' : 'matches'} · UTC
            </span>
          </div>
          {matches.map((m) => (
            <button
              className="match-center-row"
              key={m.match_id}
              aria-label={`Inspect match ${m.team_a} vs ${m.team_b}, ${m.status}, ${date(m.start_time)}`}
              onClick={() => openMatch(m.match_id)}
            >
              <span className="row-time">
                <b>{time(m.start_time)}</b>
                <small>UTC</small>
              </span>
              <span className="row-teams">
                <span>
                  <Badge name={m.team_a} />
                  <b>{m.team_a}</b>
                </span>
                <span>
                  <Badge name={m.team_b} />
                  <b>{m.team_b}</b>
                </span>
              </span>
              <span
                className="row-score"
                aria-label={
                  m.status === 'finished'
                    ? `${m.score_a} to ${m.score_b} ${m.sport === 'football' ? 'goals' : 'maps'}`
                    : 'Score unavailable'
                }
              >
                <b>{m.status === 'finished' ? m.score_a : '—'}</b>
                <b>{m.status === 'finished' ? m.score_b : '—'}</b>
              </span>
              <span className="row-event">
                <strong>{m.competition}</strong>
                <small>
                  {m.sport === 'football' ? 'Football · goals' : `Best of ${m.best_of} · maps won`}
                </small>
              </span>
              <span className={`row-state row-state-${m.status}`}>
                <i />
                {m.status === 'finished'
                  ? 'Final'
                  : m.status === 'scheduled'
                    ? 'Scheduled'
                    : m.status}
              </span>
              <ChevronRight className="row-arrow" size={16} />
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

export function MatchCenter({
  data,
  sport,
  connection,
  competitions,
  competition,
  setCompetition,
  openMatch,
  openEvent,
  openTeam,
  ask,
}: {
  data: Snapshot
  sport: Sport
  connection: Connection
  competitions: Competition[]
  competition: string
  setCompetition: (id: string) => void
  openMatch: (id: string) => void
  openEvent: (id: string) => void
  openTeam: (name: string, key?: string) => void
  ask: (question: string) => void
}) {
  const [status, setStatus] = useState('scheduled'),
    [team, setTeam] = useState(''),
    [search, setSearch] = useState(''),
    [day, setDay] = useState(''),
    [offset, setOffset] = useState(0)
  const [result, setResult] = useState<{ rows: Match[]; total: number }>({ rows: [], total: 0 }),
    [loading, setLoading] = useState(false),
    [queryError, setQueryError] = useState('')
  useEffect(() => {
    setOffset(0)
  }, [sport, status, team, search, day, competition])
  useEffect(() => {
    let active = true
    const filters: MatchFilters = {
      sport,
      status,
      competition_id: competition,
      team_name: team,
      search,
      date: day,
      offset,
    }
    setResult(filterMatches(data, competitions, filters))
    setQueryError('')
    if (connection === 'local') {
      setLoading(true)
      const timer = window.setTimeout(() => {
        void queryMatches(filters)
          .then((r) => {
            if (active) setResult({ rows: r.rows, total: r.total })
          })
          .catch(() => {
            if (active)
              setQueryError(
                'The server query is unavailable. Showing matches from the loaded snapshot only.',
              )
          })
          .finally(() => {
            if (active) setLoading(false)
          })
      }, 150)
      return () => {
        active = false
        window.clearTimeout(timer)
      }
    }
    setLoading(false)
    return () => {
      active = false
    }
  }, [data, competitions, sport, status, team, search, day, competition, offset, connection])
  const teams = [
    ...new Set(competitions.flatMap((c) => c.participants.map((p) => p.team_name))),
  ].sort()
  const summary = data.overview?.[sport],
    matches = data.matches.filter((m) => m.sport === sport),
    forecast = data.predictions.find((p) => p.sport === sport),
    card = data.model_report.sports[sport]
  function reset() {
    setSearch('')
    setTeam('')
    setDay('')
    setCompetition('')
    setOffset(0)
  }
  return (
    <>
      <div className="sports-heading">
        <div>
          <span className="sports-kicker">
            {sport === 'football' ? 'FOOTBALL / MATCH RESEARCH' : 'VALORANT / MATCH RESEARCH'}
          </span>
          <h1>
            Match center<span>.</span>
          </h1>
          <p>Fixtures, results and the evidence behind the matchup.</p>
        </div>
        <div className="sport-insignia" aria-hidden="true">
          {sport === 'football' ? (
            <>
              <span className="pitch-mini" />
              <b>90′</b>
            </>
          ) : (
            <>
              <span className="valorant-mini" />
              <b>BO3</b>
            </>
          )}
        </div>
      </div>
      <div className="research-totals">
        <span>
          <b>{summary?.total_matches ?? matches.length}</b> matches
        </span>
        <span>
          <b>{competitions.length}</b> {sport === 'football' ? 'competitions' : 'events'}
        </span>
        <span>
          <b>{summary?.teams ?? teams.length}</b> teams
        </span>
        <span>
          <b>{data.predictions.filter((p) => p.sport === sport).length}</b> forecasts
        </span>
        <span className="totals-source">
          <ShieldCheck size={13} />{' '}
          {data.manifest.data_kind === 'synthetic'
            ? 'Fictional teams · reproducible data'
            : 'Provider observations'}
        </span>
      </div>
      <div className="research-grid">
        <section className="match-center">
          <div className="match-toolbar">
            <div className="match-tabs" role="group" aria-label="Match status">
              <button
                aria-pressed={status === 'scheduled'}
                className={status === 'scheduled' ? 'active' : ''}
                onClick={() => setStatus('scheduled')}
              >
                Upcoming
              </button>
              <button
                aria-pressed={status === 'finished'}
                className={status === 'finished' ? 'active' : ''}
                onClick={() => setStatus('finished')}
              >
                Results
              </button>
              <button
                aria-pressed={!status}
                className={!status ? 'active' : ''}
                onClick={() => setStatus('')}
              >
                All matches
              </button>
            </div>
            <span className="cutoff-label">Relative to the snapshot cutoff</span>
          </div>
          <div className="match-filters">
            <label className="match-search">
              <Search size={16} />
              <span className="sr-only">Search matches</span>
              <input
                aria-label="Search matches"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams or match ID"
              />
            </label>
            <label>
              <span>{sport === 'football' ? 'Competition' : 'Event'}</span>
              <select
                aria-label={sport === 'football' ? 'Filter competition' : 'Filter event'}
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
              >
                <option value="">All {sport === 'football' ? 'competitions' : 'events'}</option>
                {competitions.map((c) => (
                  <option key={c.competition_id} value={c.competition_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Team</span>
              <select
                aria-label="Filter team"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">All teams</option>
                {teams.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Date · UTC</span>
              <input
                type="date"
                aria-label="Match date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          </div>
          <div className="match-query-meta">
            <span>
              {loading ? (
                <>
                  <span className="mini-loader" />
                  Updating matches…
                </>
              ) : (
                `${result.total.toLocaleString()} matching ${result.total === 1 ? 'match' : 'matches'}`
              )}
            </span>
            <button onClick={reset} disabled={!search && !team && !day && !competition}>
              Clear filters
            </button>
          </div>
          {queryError && (
            <p className="query-warning" role="status">
              {queryError}
            </p>
          )}
          {result.rows.length ? (
            <MatchRows rows={result.rows} openMatch={openMatch} />
          ) : (
            <Empty>No matches match these filters. Try another date, team or status.</Empty>
          )}
          {result.total > 25 && (
            <div className="match-pagination">
              <button
                disabled={!offset || loading}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                <ChevronLeft size={15} />
                Previous
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 25, result.total)} of {result.total}
              </span>
              <button
                disabled={offset + 25 >= result.total || loading}
                onClick={() => setOffset(offset + 25)}
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <div className="list-coverage">
            <Database size={12} />
            {connection === 'local' && !queryError
              ? 'Server query · complete snapshot scope'
              : 'Published / loaded snapshot coverage'}{' '}
            · scores shown only for completed matches.
          </div>
        </section>
        <aside className="research-rail">
          <section className="rail-block">
            <div className="rail-title">
              <h2>{sport === 'football' ? 'Competitions' : 'Events'}</h2>
              <span>{competitions.length}</span>
            </div>
            {competitions.map((c) => (
              <button
                className="rail-event"
                key={c.competition_id}
                onClick={() => openEvent(c.competition_id)}
              >
                <span className={`event-symbol event-symbol-${sport}`}>
                  <Trophy size={18} />
                </span>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.completed_matches} results · {c.upcoming_matches} scheduled
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </section>
          {forecast && (
            <section className="rail-block rail-forecast">
              <div className="rail-title">
                <h2>Forecast spotlight</h2>
                <span className="small-tag">Stored</span>
              </div>
              <p className="rail-match">
                <Badge name={forecast.team_a} />
                <b>{forecast.team_a}</b>
                <span>vs</span>
                <Badge name={forecast.team_b} />
                <b>{forecast.team_b}</b>
              </p>
              <ProbabilityBar prediction={forecast} compact />
              <p className="rail-disclaimer">
                Uncalibrated probabilities. Evidence frozen at {date(forecast.as_of)} UTC.
              </p>
              <button className="rail-action" onClick={() => openMatch(forecast.match_id)}>
                Inspect matchup
                <ArrowRight size={15} />
              </button>
            </section>
          )}
          <section className="rail-block">
            <div className="rail-title">
              <h2>Research desk</h2>
              <FileCheck2 size={16} />
            </div>
            <p className="rail-copy">
              Compare form before kickoff, follow the observation history and ask questions with
              sources.
            </p>
            <button
              className="rail-action"
              onClick={() =>
                ask('Explain the point-in-time prediction features and their limitations.')
              }
            >
              <Sparkles size={14} />
              Ask Arena
              <ArrowUpRight size={14} />
            </button>
            {card?.test && (
              <div className="rail-metric">
                <span>Held-out log loss</span>
                <b>
                  {card.test.model.log_loss.toFixed(3)}
                  <small>model</small>
                </b>
                <b>
                  {card.test.frequency_baseline.log_loss.toFixed(3)}
                  <small>baseline</small>
                </b>
              </div>
            )}
          </section>
          <div className="rail-coverage">
            <Flag size={13} />
            <p>
              The schedule is historical snapshot evidence. A scheduled row is not a current live
              feed.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}

function ObservedTable({
  rows,
  sport,
  openTeam,
}: {
  rows: Standing[]
  sport: Sport
  openTeam: (name: string, key?: string) => void
}) {
  return (
    <div className="table-scroll">
      <table className="observed-table" aria-label="Observed results table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            <th scope="col">P</th>
            <th scope="col">W</th>
            {sport === 'football' && <th scope="col">D</th>}
            <th scope="col">L</th>
            <th scope="col">{sport === 'football' ? 'GF' : 'MF'}</th>
            <th scope="col">{sport === 'football' ? 'GA' : 'MA'}</th>
            <th scope="col">Diff</th>
            <th scope="col">{sport === 'football' ? 'Pts' : 'Win %'}</th>
            <th scope="col">Last 5</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_key}>
              <td>{r.position}</td>
              <th scope="row">
                <button onClick={() => openTeam(r.team_name, r.team_id || r.team_key)}>
                  <Badge name={r.team_name} />
                  {r.team_name}
                  <ArrowUpRight size={13} />
                </button>
              </th>
              <td>{r.played}</td>
              <td>{r.wins}</td>
              {sport === 'football' && <td>{r.draws}</td>}
              <td>{r.losses}</td>
              <td>{r.score_for}</td>
              <td>{r.score_against}</td>
              <td>
                {r.score_difference > 0 ? '+' : ''}
                {r.score_difference}
              </td>
              <td className="table-points">{sport === 'football' ? r.points : pct(r.win_rate)}</td>
              <td>
                <span
                  className="small-form"
                  aria-label={`Last results newest first ${r.form.map((f) => f.result).join(', ')}`}
                >
                  {r.form.map((f) => (
                    <i className={`form-${f.result}`} key={f.match_id}>
                      {f.result}
                    </i>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CompetitionExplorer({
  data,
  sport,
  connection,
  competitions,
  selected,
  setSelected,
  openMatch,
  openTeam,
  partial,
}: {
  data: Snapshot
  sport: Sport
  connection: Connection
  competitions: Competition[]
  selected: string
  setSelected: (id: string) => void
  openMatch: (id: string) => void
  openTeam: (name: string, key?: string) => void
  partial: boolean
}) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [detail, setDetail] = useState<CompetitionDetail>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const chosen = competitions.find((c) => c.competition_id === selected),
    filtered = competitions.filter(
      (c) =>
        (!status || c.status === status) && c.name.toLowerCase().includes(search.toLowerCase()),
    )
  useEffect(() => {
    let active = true
    setError('')
    setDetail(undefined)
    if (!chosen) return
    setDetail(localCompetitionDetail(data, chosen))
    if (connection === 'local') {
      setLoading(true)
      void fetchCompetitionDetail(chosen.competition_id)
        .then((r) => {
          if (active) setDetail(r)
        })
        .catch(() => {
          if (active)
            setError(
              'Complete server detail is unavailable. This table covers the loaded snapshot rows only.',
            )
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    return () => {
      active = false
    }
  }, [chosen, data, connection])
  if (selected && !chosen)
    return (
      <>
        <div className="sports-heading">
          <div>
            <h1>{sport === 'football' ? 'Competition' : 'Event'} unavailable.</h1>
            <p>This identifier is not present in the observed competition directory.</p>
          </div>
        </div>
        <button className="button button-quiet" onClick={() => setSelected('')}>
          <ArrowLeft size={16} />
          Back to directory
        </button>
      </>
    )
  if (chosen && detail)
    return (
      <>
        <button className="research-back" onClick={() => setSelected('')}>
          <ArrowLeft size={15} />
          All {sport === 'football' ? 'competitions' : 'events'}
        </button>
        <div className="event-detail-heading">
          <span className={`event-symbol event-symbol-${sport}`}>
            <Trophy size={28} />
          </span>
          <div>
            <span className="sports-kicker">
              {sport === 'football' ? 'FOOTBALL COMPETITION' : 'VALORANT EVENT'}
            </span>
            <h1>{chosen.name}</h1>
            <p>
              {competitionStatus(chosen)} · {dayLabel(chosen.coverage_start)} —{' '}
              {dayLabel(chosen.coverage_end)}
            </p>
          </div>
          <span className="coverage-tag">Observed coverage</span>
        </div>
        <div className="event-detail-stats">
          <span>
            <b>{chosen.match_count}</b>matches observed
          </span>
          <span>
            <b>{chosen.participants.length}</b>participants
          </span>
          <span>
            <b>{chosen.completed_matches}</b>completed
          </span>
          <span>
            <b>{chosen.upcoming_matches}</b>scheduled at cutoff
          </span>
        </div>
        {error && (
          <p className="query-warning" role="status">
            {error}
          </p>
        )}
        <div className="event-detail-layout">
          <div>
            <section className="research-panel">
              <div className="research-panel-heading">
                <h2>Observed results table</h2>
                <span>
                  {sport === 'football'
                    ? 'Goals · 3 points win / 1 draw'
                    : 'Series wins · maps won'}
                </span>
              </div>
              <p className="table-qualification">
                Computed from accepted completed matches in this{' '}
                {sport === 'football' ? 'competition' : 'event'}. This is not official standings, a
                bracket or a complete season record.
              </p>
              <ObservedTable rows={detail.table} sport={sport} openTeam={openTeam} />
            </section>
            <section className="event-results">
              <div className="research-panel-heading">
                <h2>Match history</h2>
                <span>{loading ? 'Updating…' : `${detail.total} observed matches`}</span>
              </div>
              <MatchRows rows={detail.rows.slice(0, 30)} openMatch={openMatch} />
              {detail.total > 30 && (
                <p className="list-coverage">
                  Showing the latest 30 observations. The match center supports filtering and
                  pagination.
                </p>
              )}
            </section>
          </div>
          <aside className="research-rail">
            <section className="rail-block">
              <div className="rail-title">
                <h2>Participants</h2>
                <span>{detail.participants.length}</span>
              </div>
              {detail.participants.map((p) => (
                <button
                  className="participant-row"
                  key={p.team_key}
                  onClick={() => openTeam(p.team_name, p.team_id || p.team_key)}
                >
                  <Badge name={p.team_name} />
                  <b>{p.team_name}</b>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </section>
            <section className="rail-block event-provenance">
              <h2>Coverage, not a claim</h2>
              <dl>
                <dt>Snapshot cutoff</dt>
                <dd>{date(data.manifest.as_of, true)}</dd>
                <dt>Sources</dt>
                <dd>{chosen.source_providers.join(', ')}</dd>
                <dt>First observation</dt>
                <dd>{date(chosen.first_observed_at, true)}</dd>
                <dt>Last observation</dt>
                <dd>{date(chosen.last_observed_at, true)}</dd>
              </dl>
              <p>
                No unsupported rosters, round scores, prize pools or tournament stages are inferred.
              </p>
            </section>
          </aside>
        </div>
      </>
    )
  return (
    <>
      <div className="sports-heading">
        <div>
          <span className="sports-kicker">
            {sport === 'football'
              ? 'FOOTBALL / COMPETITION DIRECTORY'
              : 'VALORANT / EVENT DIRECTORY'}
          </span>
          <h1>
            {sport === 'football' ? 'Competitions' : 'Events'}
            <span>.</span>
          </h1>
          <p>
            Explore the competitions present in the snapshot, with a direct path to results and
            participants.
          </p>
        </div>
        <span className="directory-count">
          {competitions.length}
          <small>observed</small>
        </span>
      </div>
      <div className="event-directory-filters">
        <label className="match-search">
          <Search size={16} />
          <span className="sr-only">Search competitions</span>
          <input
            aria-label="Search competitions"
            placeholder={sport === 'football' ? 'Search competitions' : 'Search events'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Competition coverage status</span>
          <select
            aria-label="Competition coverage status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All coverage states</option>
            <option value="ongoing">Results & fixtures</option>
            <option value="completed">Results observed</option>
            <option value="upcoming">Fixtures observed</option>
            <option value="inactive">Unresolved schedules</option>
          </select>
        </label>
        <span>
          <ShieldCheck size={13} />
          Names and dates derived from observed matches
        </span>
      </div>
      {partial && (
        <p className="query-warning">This directory is limited to the loaded competition scope.</p>
      )}
      <div className="competition-directory">
        {filtered.map((c, index) => (
          <button
            className="competition-card"
            key={c.competition_id}
            onClick={() => setSelected(c.competition_id)}
            aria-label={`Inspect ${sport === 'football' ? 'competition' : 'event'} ${c.name}`}
          >
            <div
              className={`competition-art competition-art-${sport} competition-art-${index % 3}`}
              aria-hidden="true"
            >
              <span className="competition-code">
                {c.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')}
                <i>{sport === 'football' ? 'FOOTBALL' : 'VALORANT'}</i>
              </span>
              <span className="competition-grid-art" />
              <Trophy size={46} />
            </div>
            <div className="competition-card-body">
              <span className="competition-state">{competitionStatus(c)}</span>
              <h2>{c.name}</h2>
              <p>
                {new Intl.DateTimeFormat('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                }).format(new Date(c.coverage_start))}{' '}
                —{' '}
                {new Intl.DateTimeFormat('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(c.coverage_end))}
              </p>
              <div className="competition-card-stats">
                <span>
                  <b>{c.match_count}</b> matches
                </span>
                <span>
                  <b>{c.participants.length}</b> teams
                </span>
                <span>{c.score_unit}</span>
              </div>
              <div className="competition-card-foot">
                <span>Observed snapshot coverage</span>
                <ArrowUpRight size={17} />
              </div>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && <Empty>No observed competitions match these filters.</Empty>}
      <div className="directory-note">
        <CircleHelp size={17} />
        <p>
          Directory dates describe the observed match range. They do not establish an official
          season duration, event format or current tournament status.
        </p>
      </div>
    </>
  )
}

function TeamFormBlock({
  form,
  openTeam,
  side,
}: {
  form: TeamForm
  openTeam: (name: string, key?: string) => void
  side: 'A' | 'B'
}) {
  return (
    <section className="detail-team-form" aria-label={`Team ${side} recent form`}>
      <button
        className="detail-form-title"
        onClick={() => openTeam(form.team_name, form.team_id || form.team_key)}
      >
        <Badge name={form.team_name} />
        <b>{form.team_name}</b>
        <ArrowUpRight size={14} />
      </button>
      <div className="detail-form-record">
        <span>{form.played} prior matches</span>
        <b>
          {form.wins}W · {form.draws}D · {form.losses}L
        </b>
      </div>
      {form.rows.length ? (
        <div className="detail-form-results">
          {form.rows.map((r) => (
            <div key={r.match_id}>
              <i className={`form-${r.result}`}>{r.result}</i>
              <span>
                vs {r.opponent_name}
                <small>{date(r.start_time)} UTC</small>
              </span>
              <b>
                {r.score_for}–{r.score_against}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <p className="detail-no-history">No eligible completed observations before the cutoff.</p>
      )}
    </section>
  )
}

export function MatchDetailDrawer({
  id,
  data,
  connection,
  competitions,
  close,
  openEvent,
  openTeam,
  ask,
}: {
  id: string
  data: Snapshot
  connection: Connection
  competitions: Competition[]
  close: () => void
  openEvent: (id: string) => void
  openTeam: (name: string, key?: string) => void
  ask: (question: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [detail, setDetail] = useState<MatchDetail>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false)
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      if (d?.open) d.close()
    }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setCopied(false)
    setDetail(undefined)
    const match = data.matches.find((m) => m.match_id === id),
      competition = competitions.find(
        (c) => c.sport === match?.sport && c.name === match.competition,
      )
    if (match && competition) setDetail(localMatchDetail(data, match, competition))
    if (connection === 'local') {
      void fetchMatchDetail(id)
        .then((r) => {
          if (active) setDetail(r)
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : 'The match could not be loaded.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    } else {
      if (!match) setError('This match is not present in the public snapshot.')
      setLoading(!!match && !competition)
    }
    return () => {
      active = false
    }
  }, [id, data, connection, competitions])
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setError('The browser could not copy the link. You can copy the URL from the address bar.')
    }
  }
  return (
    <dialog
      ref={dialog}
      className="match-drawer"
      aria-labelledby="match-detail-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="drawer-top">
        <span>
          <GitBranch size={15} /> MATCH RESEARCH
        </span>
        <div>
          <button
            className="icon-button"
            onClick={copy}
            aria-label={copied ? 'Match link copied' : 'Copy match link'}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
          <span className="sr-only" role="status">
            {copied ? 'Match link copied' : ''}
          </span>
          <button className="icon-button" onClick={close} aria-label="Close match details">
            <X size={21} />
          </button>
        </div>
      </div>
      {!detail ? (
        <div className="drawer-loading">
          <h2 id="match-detail-title">
            {loading ? 'Loading match evidence…' : 'Match unavailable'}
          </h2>
          <p>{error || 'Reading the versioned snapshot.'}</p>
        </div>
      ) : (
        <>
          <div className="drawer-match-heading">
            <button
              className="drawer-competition"
              onClick={() => openEvent(detail.competition.competition_id)}
            >
              <Trophy size={13} />
              {detail.competition.name}
              <ArrowUpRight size={13} />
            </button>
            <h2 id="match-detail-title">
              {detail.match.team_a} <span>vs</span> {detail.match.team_b}
            </h2>
            <p>
              {date(detail.match.start_time, true)} ·{' '}
              {detail.match.sport === 'football'
                ? 'Football · goals'
                : `VALORANT · best of ${detail.match.best_of}`}
            </p>
            <div className="detail-scoreboard" role="region" aria-label="Match scoreboard">
              <button
                onClick={() => openTeam(detail.match.team_a, detail.match.team_a_id || undefined)}
              >
                <Badge name={detail.match.team_a} large />
                <strong>{detail.match.team_a}</strong>
              </button>
              <div>
                <b>
                  {detail.match.status === 'finished'
                    ? `${detail.match.score_a} : ${detail.match.score_b}`
                    : '— : —'}
                </b>
                <span>
                  {detail.match.status === 'finished'
                    ? `Final · ${detail.match.sport === 'football' ? 'goals' : 'maps won'}`
                    : detail.match.status === 'scheduled'
                      ? 'Scheduled at snapshot cutoff'
                      : `${detail.match.status} observation`}
                </span>
              </div>
              <button
                onClick={() => openTeam(detail.match.team_b, detail.match.team_b_id || undefined)}
              >
                <Badge name={detail.match.team_b} large />
                <strong>{detail.match.team_b}</strong>
              </button>
            </div>
          </div>
          {error && (
            <p className="query-warning" role="alert">
              {error}
            </p>
          )}
          <div className="drawer-body">
            <div className="detail-cutoff">
              <ShieldCheck size={17} />
              <div>
                <b>Pre-match evidence cutoff</b>
                <span>
                  {date(detail.cutoff, true)} ·{' '}
                  {detail.history_basis === 'observation_history'
                    ? 'versioned observation history'
                    : 'conservative current rows only'}
                </span>
              </div>
            </div>
            <section className="drawer-section" aria-label="Stored match forecast">
              <div className="research-panel-heading">
                <h3>Stored forecast</h3>
                <span>{detail.prediction ? 'Uncalibrated' : 'Unavailable'}</span>
              </div>
              {detail.prediction ? (
                <>
                  <ProbabilityBar prediction={detail.prediction} />
                  <p className="drawer-note">
                    {detail.prediction.model} · Probabilities read from the dataset. The chatbot
                    does not create these numbers.
                  </p>
                  <button
                    className="rail-action"
                    onClick={() =>
                      ask(`Explain the stored forecast probabilities and limitations for ${id}.`)
                    }
                  >
                    <Sparkles size={14} />
                    Explain this forecast
                    <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                <p className="drawer-note">
                  No stored forecast exists for this match. A completed result does not justify
                  reconstructing a prediction after the fact.
                </p>
              )}
            </section>
            <section className="drawer-section" aria-label="Pre-match team form">
              <div className="research-panel-heading">
                <h3>Form before kickoff</h3>
                <span>Latest 5 eligible results</span>
              </div>
              <div className="detail-form-grid">
                <TeamFormBlock side="A" form={detail.form_a} openTeam={openTeam} />
                <TeamFormBlock side="B" form={detail.form_b} openTeam={openTeam} />
              </div>
            </section>
            <section className="drawer-section" aria-label="Head-to-head evidence">
              <div className="research-panel-heading">
                <h3>Head to head</h3>
                <span>{detail.head_to_head.total} prior meetings</span>
              </div>
              <div className="h2h-summary">
                <span>
                  <b>{detail.head_to_head.team_a_wins}</b>
                  {detail.match.team_a}
                </span>
                {detail.match.sport === 'football' && (
                  <span>
                    <b>{detail.head_to_head.draws}</b>Draws
                  </span>
                )}
                <span>
                  <b>{detail.head_to_head.team_b_wins}</b>
                  {detail.match.team_b}
                </span>
              </div>
              {detail.head_to_head.rows.length ? (
                <div className="h2h-list">
                  {detail.head_to_head.rows.map((m) => (
                    <div key={m.match_id}>
                      <span>{date(m.start_time)} UTC</span>
                      <b>
                        {m.team_a}{' '}
                        <strong>
                          {m.score_a}–{m.score_b}
                        </strong>{' '}
                        {m.team_b}
                      </b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="drawer-note">
                  No head-to-head observation was available before this cutoff.
                </p>
              )}
            </section>
            <section className="drawer-section detail-provenance">
              <div className="research-panel-heading">
                <h3>Evidence trail</h3>
                <Database size={15} />
              </div>
              <dl>
                <dt>Match ID</dt>
                <dd>{id}</dd>
                <dt>Dataset</dt>
                <dd>{data.manifest.dataset_version}</dd>
                <dt>Observation</dt>
                <dd>
                  Revision {detail.match.revision} · {date(detail.match.observed_at, true)}
                </dd>
                <dt>Providers</dt>
                <dd>{detail.provenance.providers.join(', ')}</dd>
                <dt>History scope</dt>
                <dd>
                  Accepted observations across this sport. Target match and later results excluded.
                </dd>
              </dl>
              <p>
                {data.manifest.data_kind === 'synthetic'
                  ? 'Original fictional teams and match observations. No claim about real competition performance.'
                  : 'Provider-sourced observations; results and prediction validity depend on coverage.'}
              </p>
            </section>
          </div>
        </>
      )}
    </dialog>
  )
}
