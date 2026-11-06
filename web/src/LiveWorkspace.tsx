import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  Radio,
  Search,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react'
import type { LiveFilters, LiveMatch, LivePage, LiveProvider } from './live'
import { liveProviders, publishedLive, useLiveDetail, useLiveMatches } from './live'
import { date } from './components/ui'
import { Monogram } from './components/openFootballShared'
import { LiveChatPanel } from './components/LiveChatPanel'
import PublishedLiveWorkspace from './components/PublishedLiveWorkspace'
import { publishedCurrentEnabled } from './publishedLive'
import type { PublishedWorkspaceProps } from './components/PublishedLiveWorkspace'
import './live.css'

const statuses = [
  ['running', 'Running'],
  ['scheduled', 'Scheduled'],
  ['finished', 'Finished'],
  ['all', 'All statuses'],
] as const
const labels = {
  running: 'Running',
  scheduled: 'Scheduled',
  finished: 'Finished',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
}
const scoreAvailable = (match: LiveMatch) =>
  (match.status === 'running' || match.status === 'finished') &&
  match.score_a !== null &&
  match.score_b !== null
const stamp = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(new Date(value))
    : 'Not available'
function Status({ match }: { match: LiveMatch }) {
  return <span className={`live-match-status status-${match.status}`}>{labels[match.status]}</span>
}
function Scope({ page }: { page: LivePage }) {
  const scope = page.source_scope
  return (
    <span>
      {!scope
        ? 'Latest check scope is not included.'
        : scope.kind === 'competition_list'
          ? `Latest check: ${scope.competition_codes.join(' · ')} · ${scope.pages} page${scope.pages === 1 ? '' : 's'} per competition`
          : `Latest check: ${scope.phases.join(' · ')} · ${scope.pages} page${scope.pages === 1 ? '' : 's'} per phase`}
    </span>
  )
}
function HealthPanel({
  page,
  error,
  loading,
}: {
  page: LivePage
  error: string
  loading: boolean
}) {
  const stale = page.stale || !!error || page.serving_last_good
  return (
    <section
      className={`live-health ${stale ? 'is-stale' : ''}`}
      aria-label="Provider collection health"
    >
      <div className="live-health-heading">
        <div>
          <Radio size={15} />
          <h2>Provider collection</h2>
        </div>
        <span className={`live-health-badge ${stale ? 'is-stale' : ''}`}>
          {error
            ? 'Refresh failed · last verified data'
            : page.serving_last_good
              ? 'Serving last verified data'
              : page.stale
                ? 'Stale provider check'
                : page.status === 'ready'
                  ? 'Recent provider check'
                  : page.status.replaceAll('_', ' ')}
        </span>
      </div>
      <dl className="live-health-metrics">
        <div>
          <dt>Last successful provider poll</dt>
          <dd>{stamp(page.last_success_at)}</dd>
        </div>
        <div>
          <dt>Dataset observation cutoff</dt>
          <dd>{stamp(page.cutoff)}</dd>
        </div>
      </dl>
      <details className="live-health-evidence">
        <summary>
          Inspect provider health evidence <ChevronRight size={14} />
        </summary>
        <dl className="live-provenance">
          <div>
            <dt>Last publication change</dt>
            <dd>{stamp(page.last_change_at)}</dd>
          </div>
          <div>
            <dt>Latest provider check scope</dt>
            <dd>
              <Scope page={page} />
            </dd>
          </div>
          <div>
            <dt>Retained coverage</dt>
            <dd>
              {page.coverage_scope ||
                'Successful polling does not mean every retained match changed or that all competition records are included.'}
            </dd>
          </div>
          <div>
            <dt>Backend refresh</dt>
            <dd>{loading ? 'Checking local backend…' : '8s between backend checks'}</dd>
          </div>
          <div>
            <dt>Provider check interval</dt>
            <dd>
              {page.poll_interval_seconds === null
                ? 'Not available'
                : `${page.poll_interval_seconds}s · separate from browser refresh`}
            </dd>
          </div>
          <div>
            <dt>Last attempted poll</dt>
            <dd>{stamp(page.last_attempt_at)}</dd>
          </div>
          <div>
            <dt>Publication status</dt>
            <dd>
              {page.status.replaceAll('_', ' ')} · producer{' '}
              {page.producer_status?.replaceAll('_', ' ') || 'not available'}
            </dd>
          </div>
          <div>
            <dt>Last checked source rows</dt>
            <dd>
              {page.last_poll?.source_rows ?? 'Not available'}
              <small>This check's scope can differ from all retained publication records.</small>
            </dd>
          </div>
          <div>
            <dt>Changed / unsupported rows</dt>
            <dd>
              {page.last_poll
                ? `${page.last_poll.changed_rows} changed · ${page.last_poll.unsupported_rows} unsupported and excluded`
                : 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Provider request budget</dt>
            <dd>
              {page.request_budget
                ? `${page.request_budget.remaining} of ${page.request_budget.limit} requests remaining in the ${page.request_budget.window_seconds}s provider window`
                : 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Last error category</dt>
            <dd>{page.publication_error_code || page.last_error_code || 'None reported'}</dd>
          </div>
          <div>
            <dt>Dataset version</dt>
            <dd>
              <code>{page.dataset_version || 'No verified publication'}</code>
            </dd>
          </div>
          <div>
            <dt>Snapshot fingerprint</dt>
            <dd>
              <code>{page.snapshot_fingerprint || 'No verified publication'}</code>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  )
}

function CurrentDetail({
  provider,
  id,
  page,
  close,
  error: refreshError,
  expectedFingerprint = '',
}: {
  provider: LiveProvider
  id: string
  page: LivePage | undefined
  close: () => void
  error: string
  expectedFingerprint?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState('')
  const detail = useLiveDetail(provider, id, page, expectedFingerprint),
    match = detail.match
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement as HTMLElement | null
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      previous?.focus({ preventScroll: true })
    }
  }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setCopyError('Copy this match URL from the address bar; clipboard access is unavailable.')
    }
  }
  return (
    <dialog
      ref={dialog}
      className="match-drawer live-drawer"
      aria-label={match ? `${match.team_a} vs ${match.team_b}` : 'Current match details'}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header className="drawer-topline">
        <span>{liveProviders[provider].name} / CURRENT PUBLICATION</span>
        <div>
          <button
            className="icon-button"
            onClick={() => void copy()}
            aria-label={copied ? 'Current match link copied' : 'Copy current match link'}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
          <button className="icon-button" onClick={close} aria-label="Close current match details">
            <X size={21} />
          </button>
        </div>
      </header>
      <span className="sr-only" role="status">
        {copied ? 'Current match link copied' : copyError}
      </span>
      {!match ? (
        <div className="live-detail-empty">
          <Clock3 size={26} />
          <h2>{detail.error ? 'Match unavailable.' : 'Reading verified match.'}</h2>
          <p>{detail.error || 'Waiting for a consistent provider publication.'}</p>
        </div>
      ) : (
        <>
          <div className="live-detail-heading">
            <span>{match.competition}</span>
            <h2>
              {match.team_a} <i>vs</i> {match.team_b}
            </h2>
            <p>{date(match.start_time, true)} · UTC kickoff</p>
          </div>
          <section className="live-scoreboard" aria-label="Current match scoreboard">
            <div>
              <Monogram name={match.team_a} large />
              <b>{match.team_a}</b>
            </div>
            <div>
              <strong>
                {scoreAvailable(match) ? `${match.score_a} : ${match.score_b}` : '— : —'}
              </strong>
              <small>
                {liveProviders[provider].unit}
                {provider === 'pandascore' ? ` · BO${match.best_of}` : ''}
              </small>
              <Status match={match} />
            </div>
            <div>
              <Monogram name={match.team_b} large />
              <b>{match.team_b}</b>
            </div>
          </section>
          <div className="live-detail-body">
            {(page?.stale || page?.serving_last_good || refreshError || detail.error) && (
              <div className="live-warning">
                <CircleHelp size={17} />
                <span>
                  {detail.error ||
                    'Last verified publication. The latest provider check is stale or unavailable.'}
                </span>
              </div>
            )}
            <div className="live-limit">
              <ShieldCheck size={18} />
              <p>
                {provider === 'football-data'
                  ? 'Free-tier football scores are delayed. Running is the provider-reported match status; polling is not an in-game event stream.'
                  : 'Match-level VALORANT series data. No in-game rounds, player rosters or map-by-map feed are supplied.'}
              </p>
            </div>
            <LiveChatPanel
              key={`${provider}:${match.match_id}`}
              provider={provider}
              match={match}
              page={page}
            />
            <section aria-label="Current match provenance">
              <div className="live-section-heading">
                <h3>Identity &amp; observation</h3>
                <Database size={16} />
              </div>
              <dl className="live-provenance">
                <div>
                  <dt>Provider</dt>
                  <dd>{liveProviders[provider].name} · API data</dd>
                </div>
                <div>
                  <dt>Match ID</dt>
                  <dd>
                    <code>{match.match_id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Team A provider ID</dt>
                  <dd>
                    <code>{match.team_a_id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Team B provider ID</dt>
                  <dd>
                    <code>{match.team_b_id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Current revision</dt>
                  <dd>{match.revision}</dd>
                </div>
                <div>
                  <dt>Stored provider score fields</dt>
                  <dd>
                    {match.score_a ?? 'Not supplied'} : {match.score_b ?? 'Not supplied'}
                    <small>
                      {scoreAvailable(match)
                        ? 'Provider-reported score; units shown above.'
                        : 'This status does not establish play or a completed result. Default score fields are not displayed on the scoreboard.'}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Match observation</dt>
                  <dd>
                    <time dateTime={match.observed_at}>{stamp(match.observed_at)}</time>
                  </dd>
                </div>
                <div>
                  <dt>
                    {provider === 'football-data' ? 'Result known by' : 'End / known-by evidence'}
                  </dt>
                  <dd>
                    {stamp(match.completed_at)}
                    <small>
                      {provider === 'football-data'
                        ? 'Collection-time upper bound; the final-whistle time is not supplied.'
                        : 'Provider end time when supplied; otherwise a collection-time upper bound.'}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Dataset cutoff</dt>
                  <dd>{stamp(page?.cutoff)}</dd>
                </div>
                <div>
                  <dt>Dataset version</dt>
                  <dd>
                    <code>{page?.dataset_version}</code>
                  </dd>
                </div>
                <div>
                  <dt>Snapshot fingerprint</dt>
                  <dd>
                    <code>{page?.snapshot_fingerprint}</code>
                  </dd>
                </div>
                <div>
                  <dt>Event identity</dt>
                  <dd>
                    <code>{match.event_id}</code>
                  </dd>
                </div>
              </dl>
            </section>
            <p className="live-footnote">
              This is the current accepted match revision. Full history, official standings and
              forecasts are not exposed by this view.
            </p>
          </div>
        </>
      )}
    </dialog>
  )
}

export default function LiveWorkspace(props: PublishedWorkspaceProps) {
  const canonicalID =
    !!props.selectedMatch && !/^(football-data|pandascore)-[0-9a-f]{16}$/.test(props.selectedMatch)
  return publishedCurrentEnabled ||
    (!publishedLive && props.filters.workspace !== 'canonical' && !canonicalID) ? (
    <PublishedLiveWorkspace {...props} />
  ) : (
    <LocalLiveWorkspace {...props} />
  )
}

function LocalLiveWorkspace({
  provider,
  filters,
  selectedMatch,
  refresh,
  setProvider,
  setFilters,
  openMatch,
  closeMatch,
  expectedCanonicalFingerprint,
}: {
  provider: LiveProvider
  filters: LiveFilters
  selectedMatch: string
  refresh: number
  setProvider: (provider: LiveProvider) => void
  setFilters: (change: Partial<LiveFilters>, replace?: boolean) => void
  openMatch: (id: string) => void
  closeMatch: () => void
  expectedCanonicalFingerprint?: string
}) {
  const { page, error, loading } = useLiveMatches(provider, filters, refresh),
    metadata = liveProviders[provider]
  const groups = useMemo(() => {
    const byDay = new Map<string, LiveMatch[]>()
    page?.rows.forEach((match) => {
      const key = match.start_time.slice(0, 10)
      byDay.set(key, [...(byDay.get(key) || []), match])
    })
    return byDay
  }, [page])
  useEffect(() => {
    if (page && filters.page > Math.max(0, Math.ceil(page.total / 25) - 1))
      setFilters({ page: Math.max(0, Math.ceil(page.total / 25) - 1) }, true)
  }, [page?.total, filters.page])
  const stateNote =
    page?.status === 'awaiting_credentials'
      ? 'The backend is waiting for this provider’s credentials.'
      : page?.status === 'not_connected'
        ? 'This provider has no configured publication worker.'
        : page?.status === 'invalid_publication'
          ? 'An invalid publication was rejected. Only earlier verified data can be served.'
          : page?.status === 'quota_limited'
            ? 'The provider request budget is exhausted. The next allowed check is pending.'
            : page?.status === 'degraded'
              ? 'The provider reported a failed check. Review the retained publication and collection evidence.'
              : ''
  return (
    <div className="live-workspace" data-live-provider={provider}>
      {!publishedLive && (
        <button
          className="published-show-matches"
          onClick={() => setFilters({ workspace: 'directory', page: 0 })}
        >
          Current announcements <ChevronRight size={14} />
        </button>
      )}
      <div className="sports-heading live-heading">
        <div>
          <span className="sports-kicker">CURRENT PROVIDER DATA / POLLED REST</span>
          <h1>
            Current matches<span>.</span>
          </h1>
          <p>Match status, source freshness and verified revisions.</p>
        </div>
        <span className="live-heading-mark">
          <Activity size={24} />
        </span>
      </div>
      <div className="live-provider-tabs" role="group" aria-label="Select current provider">
        {(Object.keys(liveProviders) as LiveProvider[]).map((key) => (
          <button
            key={key}
            aria-pressed={provider === key}
            aria-label={`${liveProviders[key].label} provider ${liveProviders[key].name}`}
            onClick={() => setProvider(key)}
          >
            <span
              className={`sport-dot ${key === 'pandascore' ? 'valorant-dot' : 'football-dot'}`}
            />
            <b>{liveProviders[key].label}</b>
            <small>{liveProviders[key].name}</small>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {publishedLive ? (
        <section className="live-unavailable" aria-label="Live connection unavailable">
          <div className="live-offline-art">
            <Unplug size={32} />
          </div>
          <span className="sports-kicker">PUBLIC SITE / NO LIVE BACKEND CONNECTION</span>
          <h2>Live connection unavailable.</h2>
          <p>
            This published site has no configured provider API connection. Current matches require
            the local backend and a permitted provider account.
          </p>
          <p>Current-match AI and feedback are unavailable in this public site.</p>
          <div className="live-unavailable-notes">
            <div>
              <Clock3 size={18} />
              <b>Provider-aware refresh</b>
              <p>
                Successful poll time, publication changes and match observations remain separate.
              </p>
            </div>
            <div>
              <ShieldCheck size={18} />
              <b>Source limits remain visible</b>
              <p>
                Football scores are delayed. VALORANT supplies match-level series data, without
                in-game rounds.
              </p>
            </div>
          </div>
          <p className="live-footnote">
            No stored dataset is presented as live. The Open football research workspace and
            synthetic match showcase are available in the navigation.
          </p>
          <a
            href="https://github.com/Manuelma4/lakehouse-copilot/blob/main/docs/live-ui.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the live-data contract <ArrowUpRight size={15} />
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </section>
      ) : (
        <>
          <div className="live-source-limit">
            <Clock3 size={16} />
            <span>
              {provider === 'football-data'
                ? 'Scores delayed · free-tier fixtures and results'
                : 'Match-level series · no in-game round feed'}
            </span>
            <small>Retained records are not complete competition coverage.</small>
          </div>
          {page && <HealthPanel page={page} error={error} loading={loading} />}
          {error && (
            <div className="live-warning" role="alert">
              <CircleHelp size={17} />
              <span>
                {error}
                {page?.rows.length ? ' Showing the last verified page.' : ''}
              </span>
            </div>
          )}
          {stateNote && (
            <div className="live-warning" role="status">
              <CircleHelp size={17} />
              <span>{stateNote}</span>
            </div>
          )}
          <section className="live-board" aria-label="Current provider match center">
            <div className="live-board-controls">
              <div
                className="live-status-tabs"
                role="group"
                aria-label="Filter current match status"
              >
                {statuses.map(([status, name]) => (
                  <button
                    key={status}
                    aria-pressed={filters.status === status}
                    onClick={() => setFilters({ status, page: 0 })}
                  >
                    {name}
                    {status === 'running' && <Radio size={12} />}
                  </button>
                ))}
              </div>
              <label className="live-search">
                <Search size={16} />
                <input
                  aria-label="Search current matches"
                  type="search"
                  maxLength={100}
                  value={filters.search}
                  onChange={(event) => setFilters({ search: event.target.value, page: 0 }, true)}
                  placeholder="Teams or competition"
                />
              </label>
            </div>
            <div className="live-board-summary">
              <span role="status">
                {page
                  ? `${page.total.toLocaleString('en-GB')} matching provider matches`
                  : loading
                    ? 'Checking provider publication…'
                    : 'No verified publication loaded'}
              </span>
              <span>{metadata.label} · UTC kickoffs</span>
            </div>
            {!page && loading ? (
              <div className="live-empty" role="status">
                <span className="loading-ring" />
                <h2>Reading the provider publication.</h2>
                <p>Validating source identity and version before displaying records.</p>
              </div>
            ) : !page?.snapshot_available ? (
              <div className="live-empty">
                <Unplug size={28} />
                <h2>No verified provider publication.</h2>
                <p>
                  {error
                    ? 'The local backend could not be reached or its publication was rejected.'
                    : 'Collection must succeed before current provider matches are available.'}
                </p>
                <p>The browser will check again while this workspace is open.</p>
              </div>
            ) : !page.rows.length ? (
              <div className="live-empty">
                <CalendarDays size={30} />
                <h2>
                  {filters.status === 'running'
                    ? 'No running matches in this publication.'
                    : 'No provider matches for this filter.'}
                </h2>
                <p>
                  {filters.status === 'running'
                    ? 'The provider has not reported an active match in the accepted scope. Inspect scheduled matches or finished results.'
                    : 'Try a different status or competition search. Missing records can reflect provider coverage limits.'}
                </p>
                <div>
                  {filters.status === 'running' && (
                    <button
                      className="button button-secondary"
                      onClick={() => setFilters({ status: 'scheduled', page: 0 })}
                    >
                      Browse scheduled matches <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                className={`live-match-list ${page.stale || error || page.serving_last_good ? 'is-stale' : ''}`}
              >
                {Array.from(groups).map(([day, matches]) => (
                  <section
                    key={day}
                    aria-label={`Current matches on ${day}`}
                    className="live-date-group"
                  >
                    <header>
                      <time dateTime={day}>
                        {new Intl.DateTimeFormat('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(`${day}T00:00:00Z`))}
                      </time>
                      <span>{matches.length} on this page</span>
                    </header>
                    {matches.map((match) => (
                      <button
                        key={match.match_id}
                        className="live-match-row"
                        onClick={() => openMatch(match.match_id)}
                        aria-label={`Inspect current match ${match.team_a} vs ${match.team_b}, ${match.start_time}`}
                      >
                        <span className="live-row-time">
                          <b>
                            {new Intl.DateTimeFormat('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'UTC',
                            }).format(new Date(match.start_time))}
                          </b>
                          <small>
                            UTC{provider === 'pandascore' ? ` · BO${match.best_of}` : ''}
                          </small>
                        </span>
                        <span className="live-row-teams">
                          <span>
                            <Monogram name={match.team_a} />
                            <b>{match.team_a}</b>
                          </span>
                          <span>
                            <Monogram name={match.team_b} />
                            <b>{match.team_b}</b>
                          </span>
                        </span>
                        <span
                          className="live-row-score"
                          aria-label={
                            scoreAvailable(match)
                              ? `Provider score ${match.score_a} to ${match.score_b}, ${metadata.unit}`
                              : 'Provider score unavailable'
                          }
                        >
                          <b>{scoreAvailable(match) ? match.score_a : '—'}</b>
                          <b>{scoreAvailable(match) ? match.score_b : '—'}</b>
                        </span>
                        <span className="live-row-context">
                          <b>{match.competition}</b>
                          <Status match={match} />
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            )}
            {page && page.total > 25 && (
              <nav className="live-pagination" aria-label="Current match pagination">
                <span>
                  Showing {page.offset + 1}–{Math.min(page.offset + page.rows.length, page.total)}{' '}
                  of {page.total.toLocaleString('en-GB')}
                </span>
                <div>
                  <button
                    aria-label="Previous current matches page"
                    disabled={filters.page === 0}
                    onClick={() => setFilters({ page: filters.page - 1 })}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    Page {filters.page + 1} of {Math.ceil(page.total / 25)}
                  </span>
                  <button
                    aria-label="Next current matches page"
                    disabled={(filters.page + 1) * 25 >= page.total}
                    onClick={() => setFilters({ page: filters.page + 1 })}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </nav>
            )}
          </section>
          <p className="live-attribution">
            <a
              href={
                provider === 'football-data'
                  ? 'https://www.football-data.org/'
                  : 'https://pandascore.co/'
              }
              target="_blank"
              rel="noreferrer"
            >
              {provider === 'football-data'
                ? 'Football data provided by the Football-Data.org API'
                : 'Source: PandaScore'}
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </p>
          <div className="live-data-boundary">
            <ShieldCheck size={17} />
            <p>
              Checks read the locally validated provider publication; the browser does not call
              provider services. This view has no model forecasts, official standings or complete
              VLR coverage claim.
            </p>
          </div>
          {selectedMatch && (
            <CurrentDetail
              key={`${provider}:${selectedMatch}`}
              provider={provider}
              id={selectedMatch}
              expectedFingerprint={expectedCanonicalFingerprint}
              page={page}
              close={closeMatch}
              error={error}
            />
          )}
        </>
      )}
    </div>
  )
}
