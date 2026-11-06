import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  FileText,
  GitBranch,
  Globe2,
  Layers3,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  X,
} from 'lucide-react'
import type {
  OpenFootballConnection,
  OpenFootballEdition,
  OpenFootballFilters,
  OpenFootballMatch,
  OpenFootballSnapshot,
} from '../openFootball'
import {
  editionCoverage,
  collectionTime,
  parsedScore,
  resultLabel,
  searchText,
  sourceClock,
  sourceDay,
  sourceOffset,
  resolvedUtc,
} from '../openFootball'
import { date } from './ui'
import { Monogram, SourceAnchor } from './openFootballShared'
import { SourceTeamProfile, SourceTeams } from './OpenFootballTeams'
import { ResearchQuestion } from './ResearchQuestion'
import './openFootball.css'

function ClockLabel({ match }: { match: OpenFootballMatch }) {
  return (
    <span className="of-clock">
      <b>{match.local_time || '—'}</b>
      <small>{match.local_time ? 'Source local time' : 'Time unavailable'}</small>
      {match.local_time && (
        <small>
          {match.kickoff_precision === 'offset_minute'
            ? `${sourceOffset(match.utc_offset_minutes)} supplied`
            : 'Timezone unresolved'}
        </small>
      )}
      {match.kickoff_precision === 'offset_minute' && (
        <small className="of-resolved-clock">UTC shown in detail</small>
      )}
    </span>
  )
}
function Scores({ match }: { match: OpenFootballMatch }) {
  const available = match.result_status === 'observed_result'
  return (
    <span
      className={`of-scores ${available ? 'is-observed' : ''}`}
      aria-label={
        available
          ? `Observed source score ${match.score_a} to ${match.score_b}`
          : 'Score unavailable'
      }
    >
      <b>{available ? match.score_a : '—'}</b>
      <b>{available ? match.score_b : '—'}</b>
    </span>
  )
}
function RecordRow({
  match,
  openMatch,
}: {
  match: OpenFootballMatch
  openMatch: (id: string) => void
}) {
  return (
    <button
      className="of-match-row"
      onClick={() => openMatch(match.match_id)}
      aria-label={`Inspect open match ${match.team_a} vs ${match.team_b}, ${match.source_date}`}
    >
      <ClockLabel match={match} />
      <span className="of-teams">
        <span>
          <Monogram name={match.team_a} />
          <b>{match.team_a}</b>
        </span>
        <span>
          <Monogram name={match.team_b} />
          <b>{match.team_b}</b>
        </span>
      </span>
      <Scores match={match} />
      <span className="of-row-context">
        <span>
          <b>{match.competition}</b>
          <small>
            {match.season}
            {match.round ? ` · ${match.round}` : ''}
            {match.source_group ? ` · ${match.source_group}` : ''}
          </small>
        </span>
        <span
          className={`of-result ${match.result_status === 'unknown_result' ? 'is-unknown' : ''}`}
        >
          <i />
          {resultLabel(match)}
        </span>
      </span>
      <ChevronRight size={15} className="of-row-arrow" />
    </button>
  )
}

function MatchResearch({
  data,
  connection,
  id,
  close,
  openEdition,
  openTeam,
}: {
  data: OpenFootballSnapshot
  connection: OpenFootballConnection
  id: string
  close: () => void
  openEdition: (id: string) => void
  openTeam: (id: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState('')
  const match = data.matches.find((row) => row.match_id === id)
  const revisions = data.history
    .filter((row) => row.match_id === id)
    .sort((a, b) => b.revision - a.revision || b.observed_at.localeCompare(a.observed_at))
  const source = data.sources.find((row) => row.source_id === match?.source_id)
  const score = match ? parsedScore(match) : null
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement as HTMLElement | null
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      previous?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    setCopied(false)
    setCopyError('')
  }, [id])
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setCopyError('Copy the match URL from the address bar; clipboard access is unavailable.')
    }
  }
  return (
    <dialog
      ref={dialog}
      className="match-drawer of-drawer"
      aria-labelledby="of-match-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="drawer-top">
        <span>
          <Globe2 size={15} /> OPENFOOTBALL RECORD
        </span>
        <div>
          <button
            className="icon-button"
            onClick={copy}
            aria-label={copied ? 'Open match link copied' : 'Copy open match link'}
          >
            <span>{copied ? <Check size={18} /> : <Copy size={18} />}</span>
          </button>
          <span className="sr-only" role="status">
            {copied ? 'Open match link copied' : copyError}
          </span>
          <button className="icon-button" onClick={close} aria-label="Close open match details">
            <X size={21} />
          </button>
        </div>
      </div>
      {!match ? (
        <div className="drawer-loading">
          <h2 id="of-match-title">Source match unavailable</h2>
          <p>This match ID is not in the imported research package.</p>
        </div>
      ) : (
        <>
          <div className="drawer-match-heading">
            <button className="drawer-competition" onClick={() => openEdition(match.edition_id)}>
              <Layers3 size={13} />
              {match.competition} · {match.season}
              <ArrowUpRight size={13} />
            </button>
            <h2 id="of-match-title">
              {match.team_a} <span>vs</span> {match.team_b}
            </h2>
            <p>
              {sourceDay(match.source_date)}
              {match.round ? ` · ${match.round}` : ''}
            </p>
            {(match.source_group ||
              (match.source_match_number !== null && match.source_match_number !== undefined) ||
              match.ground) && (
              <div className="of-match-source-context">
                {match.source_group && <span>{match.source_group}</span>}
                {match.source_match_number !== null && match.source_match_number !== undefined && (
                  <span>Source match #{match.source_match_number}</span>
                )}
                {match.ground && (
                  <span>
                    <Globe2 size={12} />
                    {match.ground}
                  </span>
                )}
              </div>
            )}
          </div>
          <section className="of-scoreboard" aria-label="Open match scoreboard">
            <button
              onClick={() => openTeam(match.team_a_id)}
              aria-label={`Inspect source team ${match.team_a}`}
            >
              <Monogram name={match.team_a} large />
              <b>{match.team_a}</b>
            </button>
            <div>
              <strong>
                {match.result_status === 'observed_result'
                  ? `${match.score_a} : ${match.score_b}`
                  : '— : —'}
              </strong>
              <small>{resultLabel(match)}</small>
            </div>
            <button
              onClick={() => openTeam(match.team_b_id)}
              aria-label={`Inspect source team ${match.team_b}`}
            >
              <Monogram name={match.team_b} large />
              <b>{match.team_b}</b>
            </button>
          </section>
          <div className="of-drawer-body">
            <section className="of-precision" aria-label="Source kickoff precision">
              <CalendarDays size={18} />
              <div>
                <h3>{sourceDay(match.source_date)}</h3>
                <p>{sourceClock(match)}</p>
                <small>
                  {match.kickoff_precision === 'date_only'
                    ? 'Date-only record · no UTC kickoff instant'
                    : match.kickoff_precision === 'offset_minute'
                      ? 'Source numeric offset retained · UTC derived from the explicit offset; no IANA timezone assumed'
                      : 'Local-minute record · no resolved timezone or UTC kickoff instant'}
                </small>
                {resolvedUtc(match) && (
                  <div className="of-resolved-utc">
                    <span>Offset-derived UTC</span>
                    <b>{resolvedUtc(match)}</b>
                    <small>Source date and local clock remain unchanged.</small>
                  </div>
                )}
              </div>
            </section>
            <p className="of-helper">{data.manifest.precision_note}</p>
            <section className="of-detail-section" aria-label="Score detail">
              <div className="of-section-heading">
                <h3>Source score detail</h3>
                <span>{match.score_basis === 'unknown' ? 'Unavailable' : 'Source FT'}</span>
              </div>
              {score ? (
                <>
                  <div className="of-score-breakdown">
                    {Object.entries(score)
                      .filter(([key]) => ['ft', 'ht', 'et', 'p'].includes(key))
                      .map(([key, value]) => (
                        <div key={key}>
                          <span>
                            {
                              {
                                ft: 'Full-time (source)',
                                ht: 'Half-time (source)',
                                et: 'Extra-time (source)',
                                p: 'Penalties (source)',
                              }[key]
                            }
                          </span>
                          <b>
                            {Array.isArray(value) && value.length === 2
                              ? `${String(value[0])} – ${String(value[1])}`
                              : 'Unsupported source value'}
                          </b>
                        </div>
                      ))}
                  </div>
                  <p className="of-helper">
                    Source FT is preserved as supplied; a 90-minute outcome is not guaranteed.
                    Additional score fields do not establish a qualification bracket.
                  </p>
                </>
              ) : (
                <p className="of-helper">
                  The source has no accepted score. This is neither a 0–0 result nor evidence of a
                  scheduled or postponed match.
                </p>
              )}
            </section>
            <section className="of-no-model">
              <ShieldCheck size={18} />
              <div>
                <b>Research record · no forecast attached</b>
                <p>
                  These imports are not prediction eligible. Collection timestamps do not establish
                  historical pre-match availability.
                </p>
              </div>
            </section>
            <ResearchQuestion
              data={data}
              connection={connection}
              context={{
                kind: 'match',
                id: match.match_id,
                label: `${match.team_a} vs ${match.team_b}`,
              }}
            />
            <section className="of-detail-section" aria-label="Match revisions">
              <div className="of-section-heading">
                <h3>Observation history</h3>
                <span>
                  {revisions.length} stored {revisions.length === 1 ? 'revision' : 'revisions'}
                </span>
              </div>
              {revisions.length ? (
                <ol className="of-revisions">
                  {revisions.slice(0, 20).map((row) => (
                    <li key={row.event_id}>
                      <span className="of-revision-number">r{row.revision}</span>
                      <div>
                        <b>
                          {resultLabel(row)}
                          {row.result_status === 'observed_result'
                            ? ` · ${row.score_a}–${row.score_b}`
                            : ''}
                        </b>
                        <small>Collected {date(row.observed_at, true)}</small>
                        <code>{row.source_sha256.slice(0, 16)}</code>
                      </div>
                      {row.event_id === match.event_id && <span>Current</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="of-helper">No revision history was included for this record.</p>
              )}
              {revisions.length > 20 && (
                <p className="of-helper">
                  Showing the latest 20 of {revisions.length} stored observations.
                </p>
              )}
              <p className="of-helper">
                These are source collection revisions, not asserted match completion or original
                publication times.
              </p>
            </section>
            <section className="of-detail-section" aria-label="Source provenance">
              <div className="of-section-heading">
                <h3>Source provenance</h3>
                <FileText size={16} />
              </div>
              <dl className="of-provenance">
                <div>
                  <dt>Dataset</dt>
                  <dd>
                    <code>{data.manifest.dataset_version}</code>
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    <SourceAnchor href={match.source_url}>
                      {source?.path || match.source_id}
                    </SourceAnchor>
                  </dd>
                </div>
                <div>
                  <dt>Source reference</dt>
                  <dd>
                    <code>{match.source_ref || 'Not pinned'}</code>
                  </dd>
                </div>
                <div>
                  <dt>Content SHA256</dt>
                  <dd>
                    <code>{match.source_sha256}</code>
                  </dd>
                </div>
                <div>
                  <dt>Collected</dt>
                  <dd>{date(match.observed_at, true)}</dd>
                </div>
                <div>
                  <dt>Team identities</dt>
                  <dd>
                    {match.team_identity_status.replaceAll('_', ' ')}
                    <small>{source?.team_namespace || 'Source-scoped identity'}</small>
                  </dd>
                </div>
                <div>
                  <dt>Availability basis</dt>
                  <dd>{match.availability_basis}</dd>
                </div>
                <div>
                  <dt>Match number</dt>
                  <dd>{match.source_match_number ?? 'Not supplied'}</dd>
                </div>
                <div>
                  <dt>Source group</dt>
                  <dd>{match.source_group || 'Not supplied'}</dd>
                </div>
                <div>
                  <dt>Ground</dt>
                  <dd>{match.ground || 'Not supplied'}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{data.manifest.coverage_note}</dd>
                </div>
                <div>
                  <dt>Package fingerprint</dt>
                  <dd>
                    <code>{data.snapshot_fingerprint}</code>
                  </dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>
                    <SourceAnchor href={match.license_url}>{match.license}</SourceAnchor>
                  </dd>
                </div>
                <div>
                  <dt>Match ID</dt>
                  <dd>
                    <code>{match.match_id}</code>
                  </dd>
                </div>
              </dl>
            </section>
            <p className="of-bottom-note">
              Community-maintained import. No real-time feed, official standings or complete season
              coverage is implied.
            </p>
          </div>
        </>
      )}
    </dialog>
  )
}

export default function OpenFootballWorkspace({
  data,
  connection,
  selectedEdition,
  selectedMatch,
  setEdition,
  openMatch,
  closeMatch,
  selectedTeam,
  section,
  teamFilter,
  setSection,
  openTeam,
  backTeam,
  viewTeamRecords,
  clearTeamFilter,
  resetScope,
  filters,
  setFilters,
}: {
  data: OpenFootballSnapshot
  connection: OpenFootballConnection
  selectedEdition: string
  selectedMatch: string
  setEdition: (id: string) => void
  openMatch: (id: string) => void
  closeMatch: () => void
  selectedTeam: string
  section: string
  teamFilter: string
  setSection: (section: 'matches' | 'teams') => void
  openTeam: (id: string) => void
  backTeam: () => void
  viewTeamRecords: (id: string) => void
  clearTeamFilter: () => void
  resetScope: () => void
  filters: OpenFootballFilters
  setFilters: (change: Partial<OpenFootballFilters>, replace?: boolean) => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(0)
  const { search, region, day, status, group, round } = filters
  const regions = useMemo(
    () => Array.from(new Set(data.competitions.map((edition) => edition.region))).sort(),
    [data],
  )
  const editions = data.competitions.filter((edition) => !region || edition.region === region)
  const selected = data.competitions.find((edition) => edition.edition_id === selectedEdition)
  const editionById = useMemo(
    () => new Map(data.competitions.map((edition) => [edition.edition_id, edition])),
    [data],
  )
  const scope = useMemo(
    () =>
      data.matches.filter(
        (match) =>
          (!region || editionById.get(match.edition_id)?.region === region) &&
          (!selectedEdition || match.edition_id === selectedEdition) &&
          (!teamFilter || match.team_a_id === teamFilter || match.team_b_id === teamFilter),
      ),
    [data, region, selectedEdition, editionById, teamFilter],
  )
  const filtered = useMemo(() => {
    const needle = searchText(search.trim())
    return scope
      .filter(
        (match) =>
          (!day || match.source_date === day) &&
          (!group || match.source_group === group) &&
          (!round || match.round === round) &&
          (status === 'all' || match.result_status === status) &&
          (!needle ||
            searchText(
              `${match.team_a} ${match.team_b} ${match.competition} ${match.season} ${match.round || ''} ${match.source_group || ''} ${match.match_id}`,
            ).includes(needle)),
      )
      .sort(
        (a, b) =>
          b.source_date.localeCompare(a.source_date) ||
          (a.local_time || '').localeCompare(b.local_time || '') ||
          a.match_id.localeCompare(b.match_id),
      )
  }, [scope, day, status, search, group, round])
  const sourceLabels = useMemo(() => {
    const rows = data.matches.filter(
      (match) =>
        (!selectedEdition || match.edition_id === selectedEdition) &&
        (!region || editionById.get(match.edition_id)?.region === region),
    )
    const labels = (key: 'source_group' | 'round') =>
      Array.from(
        new Set(
          rows
            .map((match) => match[key])
            .filter((value): value is string => typeof value === 'string' && !!value),
        ),
      ).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    return { groups: labels('source_group'), rounds: labels('round') }
  }, [data, selectedEdition, region, editionById])
  useEffect(() => {
    setPage(0)
  }, [search, region, day, status, group, round, selectedEdition, teamFilter, data])
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1),
    activePage = Math.min(page, lastPage)
  const visible = filtered.slice(activePage * 25, activePage * 25 + 25)
  const groups = new Map<string, OpenFootballMatch[]>()
  visible.forEach((match) =>
    groups.set(match.source_date, [...(groups.get(match.source_date) || []), match]),
  )
  const observed = scope.filter((match) => match.result_status === 'observed_result').length
  const activeFilters =
    !!search ||
    !!region ||
    !!day ||
    !!selectedEdition ||
    !!teamFilter ||
    !!group ||
    !!round ||
    status !== 'observed_result'
  function selectEdition(id: string) {
    setEdition(id)
    setPage(0)
  }
  function reset() {
    resetScope()
    setPage(0)
  }
  function changeRegion(value: string) {
    setFilters({ region: value, group: '', round: '' })
  }
  return (
    <div className="open-football-workspace">
      {!selectedTeam && section !== 'teams' && (
        <div className="sports-heading of-heading">
          <div>
            <span className="sports-kicker">FOOTBALL / COMMUNITY SOURCE RESEARCH</span>
            <h1>
              Open football<span>.</span>
            </h1>
            <p>Real match records. Source precision and provenance in view.</p>
          </div>
          <span className="of-source-seal">
            <Globe2 size={25} />
            <b>
              OPEN
              <br />
              DATA
            </b>
          </span>
        </div>
      )}
      {!selectedTeam && section !== 'teams' && (
        <div className="of-evidence-strip">
          <span>
            <Database size={15} />
            <b>{data.matches.length.toLocaleString('en-GB')}</b> imported matches
          </span>
          <span>
            <Layers3 size={15} />
            <b>{data.competitions.length}</b> source editions
          </span>
          <span>
            <CheckCircle2 size={15} />
            <b>
              {data.matches
                .filter((match) => match.result_status === 'observed_result')
                .length.toLocaleString('en-GB')}
            </b>{' '}
            observed results
          </span>
          <span>
            <CircleHelp size={15} />
            <b>
              {data.matches
                .filter((match) => match.result_status === 'unknown_result')
                .length.toLocaleString('en-GB')}
            </b>{' '}
            unknown results
          </span>
        </div>
      )}
      <div className="of-coverage-note">
        <ShieldCheck size={16} />
        <p>
          Community-maintained records. Results may be incomplete; imported coverage is not a live
          feed.
        </p>
      </div>
      <nav className="of-research-navigation" aria-label="Open football research">
        <button
          onClick={() => setSection('matches')}
          aria-current={!selectedTeam && section !== 'teams' ? 'page' : undefined}
        >
          Match records
          <CalendarDays size={15} />
        </button>
        <button
          onClick={() => setSection('teams')}
          aria-current={!!selectedTeam || section === 'teams' ? 'page' : undefined}
        >
          Source teams
          <Globe2 size={15} />
        </button>
        {data.teams && (
          <span>
            {data.teams.length} source identities · {data.sources.length} imported sources
          </span>
        )}
      </nav>
      {selectedTeam ? (
        <SourceTeamProfile
          data={data}
          connection={connection}
          id={selectedTeam}
          back={backTeam}
          openTeam={openTeam}
          openEdition={selectEdition}
          openMatch={openMatch}
          viewRecords={viewTeamRecords}
        />
      ) : section === 'teams' ? (
        <SourceTeams data={data} openTeam={openTeam} />
      ) : (
        <div className="of-workspace-grid">
          <aside className="of-edition-rail" aria-label="Source edition directory">
            <div className="of-section-heading">
              <h2>Source editions</h2>
              <span>{editions.length}</span>
            </div>
            <button
              className={`of-all-editions ${!selectedEdition ? 'active' : ''}`}
              onClick={() => selectEdition('')}
              aria-pressed={!selectedEdition}
            >
              <Globe2 size={15} />
              All imported editions
              <ChevronRight size={15} />
            </button>
            {regions
              .filter((value) => !region || region === value)
              .map((value) => (
                <section key={value} aria-label={`${value} editions`}>
                  <h3>{value}</h3>
                  {editions
                    .filter((edition) => edition.region === value)
                    .map((edition) => (
                      <button
                        key={edition.edition_id}
                        className={`of-edition ${selectedEdition === edition.edition_id ? 'selected' : ''}`}
                        onClick={() => selectEdition(edition.edition_id)}
                        aria-label={`Inspect source edition ${edition.name}, ${edition.season}`}
                        aria-pressed={selectedEdition === edition.edition_id}
                      >
                        <span className="of-edition-art" aria-hidden="true">
                          <span className="pitch-mini" />
                        </span>
                        <span>
                          <b>{edition.name}</b>
                          <small>{edition.season}</small>
                          <span className="of-edition-counts">
                            {edition.match_count.toLocaleString('en-GB')} records ·{' '}
                            {edition.unknown_results.toLocaleString('en-GB')} unknown
                          </span>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </section>
              ))}
            <p className="of-rail-note">
              Only imported editions appear. Missing countries, rounds or seasons are coverage gaps,
              not empty competitions.
            </p>
          </aside>
          <section className="of-match-center" aria-label="Open football match center">
            {teamFilter && (
              <div className="of-team-filter-chip">
                <span>
                  Records for{' '}
                  <b>
                    {data.teams?.find((team) => team.team_id === teamFilter)?.team_name ||
                      teamFilter}
                  </b>
                </span>
                <button onClick={clearTeamFilter} aria-label="Clear source team filter">
                  <X size={15} />
                </button>
              </div>
            )}
            <div className={`of-section-heading of-current-scope ${selected ? 'has-edition' : ''}`}>
              <div>
                <span className="sports-kicker">
                  {selected ? selected.region : 'IMPORTED COVERAGE'}
                </span>
                <h2>{selected?.name || 'All source editions'}</h2>
                {selected && (
                  <p>
                    {selected.season} · {sourceDay(selected.coverage_start)} –{' '}
                    {sourceDay(selected.coverage_end)}
                    <small>Observed source calendar-date range</small>
                  </p>
                )}
              </div>
              <span className="of-scope-count">
                <b>{scope.length.toLocaleString('en-GB')}</b> records
                <small>
                  {observed.toLocaleString('en-GB')} results ·{' '}
                  {(scope.length - observed).toLocaleString('en-GB')} unknown
                </small>
              </span>
            </div>
            {selectedEdition && !selected && (
              <div className="notice notice-error" role="alert">
                This source edition is not in the imported package.{' '}
                <button onClick={() => selectEdition('')}>Show all editions</button>
              </div>
            )}
            {selected && <SourceCoverage data={data} edition={selected} />}
            <div
              id="open-source-filters"
              className={`of-match-filters ${filtersOpen ? 'filters-open' : ''}`}
            >
              <label className="of-search">
                <span>Search records</span>
                <span className="of-input-icon">
                  <Search size={16} />
                  <input
                    aria-label="Search open football"
                    type="search"
                    value={search}
                    onChange={(event) => setFilters({ search: event.target.value }, true)}
                    placeholder="Teams, competition, group or match ID"
                  />
                </span>
              </label>
              <label className="of-extra-filter">
                <span>Region</span>
                <select
                  aria-label="Filter region"
                  value={region}
                  onChange={(event) => changeRegion(event.target.value)}
                >
                  <option value="">All imported regions</option>
                  {regions.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="of-extra-filter">
                <span>Edition</span>
                <select
                  aria-label="Filter edition"
                  value={selectedEdition}
                  onChange={(event) => selectEdition(event.target.value)}
                >
                  <option value="">All source editions</option>
                  {editions.map((edition) => (
                    <option key={edition.edition_id} value={edition.edition_id}>
                      {edition.name} · {edition.season}
                    </option>
                  ))}
                </select>
              </label>
              <label className="of-extra-filter">
                <span>Source calendar date</span>
                <input
                  aria-label="Source calendar date"
                  type="date"
                  value={day}
                  onChange={(event) => setFilters({ day: event.target.value })}
                />
              </label>
              <label className="of-extra-filter">
                <span>Source group</span>
                <select
                  aria-label="Filter source group"
                  value={sourceLabels.groups.includes(group) ? group : ''}
                  onChange={(event) => setFilters({ group: event.target.value })}
                  disabled={!sourceLabels.groups.length && !group}
                >
                  <option value="">
                    {sourceLabels.groups.length ? 'All supplied groups' : 'No groups supplied'}
                  </option>
                  {sourceLabels.groups.map((label) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
                {group && !sourceLabels.groups.includes(group) && (
                  <small className="of-missing-filter">
                    Requested group is not supplied in this scope. Clear source filters to reset.
                  </small>
                )}
              </label>
              <label className="of-extra-filter">
                <span>Source round</span>
                <select
                  aria-label="Filter source round"
                  value={sourceLabels.rounds.includes(round) ? round : ''}
                  onChange={(event) => setFilters({ round: event.target.value })}
                  disabled={!sourceLabels.rounds.length && !round}
                >
                  <option value="">
                    {sourceLabels.rounds.length ? 'All supplied rounds' : 'No rounds supplied'}
                  </option>
                  {sourceLabels.rounds.map((label) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
                {round && !sourceLabels.rounds.includes(round) && (
                  <small className="of-missing-filter">
                    Requested round is not supplied in this scope. Clear source filters to reset.
                  </small>
                )}
              </label>
            </div>
            <div className="of-result-controls">
              <div className="of-result-tabs" role="group" aria-label="Open football result status">
                {[
                  ['all', 'All records'],
                  ['observed_result', 'Observed result'],
                  ['unknown_result', 'Result unknown'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={status === value ? 'active' : ''}
                    aria-pressed={status === value}
                    onClick={() => setFilters({ status: value as OpenFootballFilters['status'] })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="of-filter-toggle"
                onClick={() => setFiltersOpen(!filtersOpen)}
                aria-label="Filter source records"
                aria-expanded={filtersOpen}
                aria-controls="open-source-filters"
              >
                <SlidersHorizontal size={17} />
                <span className="sr-only">
                  Source date, edition, region, group and round filters
                </span>
              </button>
            </div>
            <div className="of-match-count">
              <span role="status">
                {filtered.length.toLocaleString('en-GB')} matching source{' '}
                {filtered.length === 1 ? 'record' : 'records'}
              </span>
              <button onClick={reset} disabled={!activeFilters}>
                Clear source filters
                <X size={12} />
              </button>
            </div>
            {!visible.length ? (
              <div className="of-empty" role="status">
                <Search size={26} />
                <h3>No imported matches for this filter.</h3>
                <p>Source coverage may be incomplete. Try another date, edition or team.</p>
                {activeFilters && (
                  <button className="button button-secondary" onClick={reset}>
                    Clear source filters
                    <ArrowRight size={15} />
                  </button>
                )}
              </div>
            ) : (
              Array.from(groups).map(([value, rows]) => (
                <section
                  className="of-date-group"
                  key={value}
                  aria-label={`Source matches on ${value}`}
                >
                  <header>
                    <h3>{sourceDay(value)}</h3>
                    <span>
                      {rows.length} {rows.length === 1 ? 'record' : 'records'} · source calendar
                      date
                    </span>
                  </header>
                  {rows.map((match) => (
                    <RecordRow key={match.match_id} match={match} openMatch={openMatch} />
                  ))}
                </section>
              ))
            )}
            {filtered.length > 25 && (
              <nav className="of-pagination" aria-label="Open football pagination">
                <span>
                  Showing {activePage * 25 + 1}–{Math.min((activePage + 1) * 25, filtered.length)}{' '}
                  of {filtered.length.toLocaleString('en-GB')}
                </span>
                <div>
                  <button
                    onClick={() => setPage(activePage - 1)}
                    disabled={activePage === 0}
                    aria-label="Previous source records page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Page {activePage + 1} / {lastPage + 1}
                  </span>
                  <button
                    onClick={() => {
                      setPage(activePage + 1)
                      window.scrollTo({ top: 0, behavior: 'instant' })
                    }}
                    disabled={activePage === lastPage}
                    aria-label="Next source records page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </nav>
            )}
            <p className="of-match-disclosure">
              <CalendarDays size={14} />
              {data.manifest.precision_note ||
                'Dates and local clocks retain source precision; no UTC kickoff is inferred.'}
            </p>
            {selected && (
              <>
                <EditionContext edition={selected} openTeam={openTeam} />
                <ResearchQuestion
                  key={selected.edition_id}
                  data={data}
                  connection={connection}
                  context={{
                    kind: 'edition',
                    id: selected.edition_id,
                    label: `${selected.name}, ${selected.season}`,
                  }}
                />
              </>
            )}
          </section>
        </div>
      )}
      <section className="of-import-notes" aria-label="OpenFootball import evidence">
        <div>
          <GitBranch size={18} />
          <h3>A separate research contract</h3>
          <p>
            These real community records are separate from the synthetic lakehouse and its stored
            model forecasts. Collection history records when bytes were imported, not what was known
            before a historic kickoff.
          </p>
        </div>
        <div>
          <FileText size={18} />
          <h3>Traceable, open source data</h3>
          <p>
            {data.sources.length} reviewed sources · CC0-1.0 ·{' '}
            {data.history.length.toLocaleString('en-GB')} stored observations. Inspect a match to
            see its source reference, content checksum and accepted revisions.
          </p>
        </div>
      </section>
      {selectedMatch && (
        <MatchResearch
          key={selectedMatch}
          data={data}
          connection={connection}
          id={selectedMatch}
          close={closeMatch}
          openEdition={selectEdition}
          openTeam={openTeam}
        />
      )}
    </div>
  )
}

function SourceCoverage({
  data,
  edition,
}: {
  data: OpenFootballSnapshot
  edition: OpenFootballEdition
}) {
  const coverage = useMemo(
    () => editionCoverage(data, edition.edition_id),
    [data, edition.edition_id],
  )
  return (
    <section className="of-source-coverage" aria-label="Source collection and coverage">
      <div className="of-section-heading">
        <h3>Collection &amp; coverage</h3>
        <span>Full imported edition</span>
      </div>
      <dl className="of-coverage-metrics">
        <div>
          <dt>Last successful source check</dt>
          <dd>
            {coverage.latestPoll ? (
              <time dateTime={coverage.latestPoll.observed_at}>
                {collectionTime(coverage.latestPoll.observed_at)}
              </time>
            ) : (
              'Not included'
            )}
          </dd>
        </div>
        <div>
          <dt>Latest included result date</dt>
          <dd>{sourceDay(coverage.latestResultDate)}</dd>
        </div>
        <div>
          <dt>Observed results</dt>
          <dd>
            {coverage.observed.toLocaleString('en-GB')}
            <small>of {coverage.records.toLocaleString('en-GB')} imported records</small>
          </dd>
        </div>
        <div>
          <dt>Results unknown</dt>
          <dd>
            {coverage.unknown.toLocaleString('en-GB')}
            <small>Missing source scores</small>
          </dd>
        </div>
      </dl>
      <p>A successful check does not establish complete results or a live feed.</p>
      <details className="of-collection-details">
        <summary>
          Inspect collection evidence <ChevronRight size={13} />
        </summary>
        <dl className="of-provenance">
          <div>
            <dt>Latest included match observation</dt>
            <dd>
              {coverage.latestMatchObservedAt ? (
                <time dateTime={coverage.latestMatchObservedAt}>
                  {collectionTime(coverage.latestMatchObservedAt)}
                </time>
              ) : (
                'Not included'
              )}
            </dd>
          </div>
          <div>
            <dt>Package cutoff</dt>
            <dd>
              <time dateTime={data.manifest.as_of}>{collectionTime(data.manifest.as_of)}</time>
            </dd>
          </div>
          <div>
            <dt>Successful checks included</dt>
            <dd>{coverage.successfulChecks}</dd>
          </div>
          <div>
            <dt>Latest check outcome</dt>
            <dd>
              {coverage.latestPoll
                ? coverage.latestPoll.status === 'not_modified'
                  ? 'Not modified'
                  : `Collected · ${coverage.latestPoll.changed} changed records`
                : 'Not included'}
              <small>Packaged successful checks only; failed attempts are not represented.</small>
            </dd>
          </div>
          <div>
            <dt>Source clock precision</dt>
            <dd>
              {coverage.dateOnly} date only · {coverage.localMinute} local minute ·{' '}
              {coverage.offsetMinute} explicit offset
            </dd>
          </div>
          <div>
            <dt>Current source reference</dt>
            <dd>
              <code>{coverage.source?.source_ref || 'Not pinned'}</code>
              {coverage.source?.source_ref && (
                <small>
                  {/^[a-f0-9]{40}$/.test(coverage.source.source_ref)
                    ? 'Pinned upstream commit'
                    : 'Moving upstream reference; not a pinned commit'}
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>Last checked content SHA256</dt>
            <dd>
              <code>{coverage.latestPoll?.sha256 || 'Not included'}</code>
            </dd>
          </div>
          <div>
            <dt>Source path</dt>
            <dd>
              <code>{coverage.source?.path || 'Not included'}</code>
            </dd>
          </div>
        </dl>
        <p className="of-helper">
          Match observations describe imported revisions. Source result dates retain calendar
          precision; none of these fields establish original publication or match completion.
        </p>
      </details>
    </section>
  )
}

function EditionContext({
  edition,
  openTeam,
}: {
  edition: OpenFootballEdition
  openTeam: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="of-participants" aria-label="Source edition participants">
      <div className="of-section-heading">
        <h3>Observed participants</h3>
        <span>{edition.participants.length}</span>
      </div>
      <div>
        {edition.participants.slice(0, expanded ? undefined : 12).map((team) => (
          <button
            key={team.team_id}
            onClick={() => openTeam(team.team_id)}
            aria-label={`Inspect source team ${team.team_name}`}
          >
            <Monogram name={team.team_name} />
            {team.team_name}
          </button>
        ))}
      </div>
      {edition.participants.length > 12 && (
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded
            ? 'Show fewer participants'
            : `Show all ${edition.participants.length} participants`}
        </button>
      )}
      <p className="of-helper">
        Source-scoped team identities. This is neither an official roster nor a complete membership
        list.
      </p>
    </section>
  )
}
