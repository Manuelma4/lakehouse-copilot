import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Radio,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { LiveFilters, LiveProvider } from '../live'
import { liveProviders } from '../live'
import {
  cardInEvent,
  dateFilterError,
  displayStale,
  displayView,
  filterDisplayCards,
  usePublishedDisplay,
} from '../publishedLive'
import type { DisplayCard, DisplayPackage, DisplayView, DirectoryNode } from '../publishedLive'
import { Monogram } from './openFootballShared'
import './publishedLive.css'

export interface PublishedWorkspaceProps {
  provider: LiveProvider
  filters: LiveFilters
  selectedMatch: string
  refresh: number
  setProvider: (provider: LiveProvider) => void
  setFilters: (change: Partial<LiveFilters>, replace?: boolean) => void
  openMatch: (id: string) => void
  closeMatch: () => void
  openCanonical?: (id: string, fingerprint: string) => void
  expectedCanonicalFingerprint?: string
}
const stamp = (value: string | null) =>
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
    : 'Unavailable in this publication'
const rival = (team: DisplayCard['team_a']) => team?.label || 'Opponent pending'
const resultLabel = (card: DisplayCard) =>
  card.result_state === 'final'
    ? 'Final result'
    : card.result_state === 'provisional'
      ? 'Provisional score'
      : card.result_state === 'source_reported'
        ? 'Source-reported score'
        : 'Result unavailable'
const kickoffText = (card: DisplayCard) =>
  card.kickoff_precision === 'utc'
    ? stamp(card.kickoff_utc)
    : card.kickoff_precision === 'source_date'
      ? `${card.kickoff_source_text} · time unavailable`
      : card.kickoff_precision === 'timezone_unknown'
        ? `${card.kickoff_source_text} · timezone unknown`
        : 'Date and time unavailable'
function Scope({ data }: { data: DisplayView }) {
  const scope = data.health.source_scope
  return (
    <span>
      {!scope
        ? 'Source check scope is unknown.'
        : scope.kind === 'competition_list'
          ? `${scope.competition_codes.join(' · ')} · ${scope.pages} page(s) per competition`
          : `${scope.phases.join(' · ')} · ${scope.pages} page(s) per phase`}
    </span>
  )
}
function PublishedDetail({
  id,
  data,
  pkg,
  close,
  stale,
  openCanonical,
}: {
  id: string
  data: DisplayView
  pkg: DisplayPackage
  close: () => void
  stale: boolean
  openCanonical?: PublishedWorkspaceProps['openCanonical']
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    card = data.cards.find((row) => row.display_id === id),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState('')
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => {
      element?.close()
      const returnTo =
        previous && previous !== document.body && previous.isConnected
          ? previous
          : document.querySelector<HTMLButtonElement>(`[data-display-id="${CSS.escape(id)}"]`)
      returnTo?.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="match-drawer live-drawer published-drawer"
      aria-label={
        card ? `${rival(card.team_a)} vs ${rival(card.team_b)}` : 'Published match unavailable'
      }
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header className="drawer-topline">
        <span>CURRENT MATCH</span>
        <div>
          <button
            className="icon-button"
            aria-label={copied ? 'Published match link copied' : 'Copy published match link'}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
                setCopied(true)
              } catch {
                setCopyError('Copy the match URL from the browser address bar.')
              }
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
          <button className="icon-button" aria-label="Close published match" onClick={close}>
            <X size={20} />
          </button>
        </div>
      </header>
      {copyError && (
        <p role="status" className="live-footnote">
          {copyError}
        </p>
      )}
      {!card ? (
        <div className="live-detail-body">
          <h2>Match not in this published window.</h2>
          <p>
            The display may have moved to a new window. No canonical record or substitute match is
            fetched.
          </p>
        </div>
      ) : (
        <>
          <div className="live-detail-heading">
            <span className="sports-kicker">{card.competition_label}</span>
            <h2>
              {rival(card.team_a)} <span>vs</span> {rival(card.team_b)}
            </h2>
            <p>{kickoffText(card)} · source-reported kickoff</p>
          </div>
          <section className="live-scoreboard" aria-label="Published match scoreboard">
            <div>
              {card.team_a ? (
                <Monogram name={card.team_a.label} large />
              ) : (
                <span className="published-pending-mark">?</span>
              )}
              <b>{rival(card.team_a)}</b>
            </div>
            <div>
              <strong>{card.score_label || '—'}</strong>
              <small>
                {liveProviders[data.provider].unit} ·{' '}
                {card.series_format || 'Series format unavailable'}
              </small>
              <span className="live-match-status">
                {card.status_label} · {resultLabel(card)}
              </span>
            </div>
            <div>
              {card.team_b ? (
                <Monogram name={card.team_b.label} large />
              ) : (
                <span className="published-pending-mark">?</span>
              )}
              <b>{rival(card.team_b)}</b>
            </div>
          </section>
          <div className="live-detail-body">
            {openCanonical &&
              (pkg.canonical_links?.[data.provider][id] ? (
                <button
                  className="published-show-matches"
                  onClick={() => {
                    const link = pkg.canonical_links![data.provider][id]
                    openCanonical(link.match_id, link.snapshot_fingerprint)
                  }}
                >
                  Inspect validated record <ChevronRight size={14} />
                </button>
              ) : (
                <p className="published-warning">
                  No validated record or AI context is supplied for this announcement.
                </p>
              ))}
            {stale && (
              <p className="published-warning" role="status">
                This retained display is stale. Check the original source poll time below.
              </p>
            )}
            <section aria-label="Published match provenance">
              <div className="live-section-heading">
                <h3>Processed source details</h3>
                <Database size={16} />
              </div>
              <dl className="live-provenance">
                <div>
                  <dt>Display identity</dt>
                  <dd>
                    <code>{card.display_id}</code>
                    <small>Derived site key; not an original provider match or event ID.</small>
                  </dd>
                </div>
                <div>
                  <dt>Team display identities</dt>
                  <dd>
                    <code>
                      {card.team_a?.display_id || 'Opponent pending'}
                      <br />
                      {card.team_b?.display_id || 'Opponent pending'}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Current announcement</dt>
                  <dd>
                    {card.announcement_label || 'Name unavailable'}
                    <small>
                      {card.resolution === 'legacy'
                        ? 'Match-only source publication; calendar resolution unavailable'
                        : `${card.resolution} · ${card.association_state.replaceAll('_', ' ')}`}
                    </small>
                    {card.pending_reasons.length > 0 && (
                      <small>
                        {card.pending_reasons
                          .map((reason) => reason.replaceAll('_', ' '))
                          .join(' · ')}
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Supplied kickoff precision</dt>
                  <dd>
                    {card.kickoff_precision.replaceAll('_', ' ')}
                    <small>
                      {card.kickoff_source_text || 'Original source date text unavailable'}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Observed source events</dt>
                  <dd>
                    {card.event_node_ids.length
                      ? card.event_node_ids.map((eventID) => {
                          const node = data.directory_nodes.find(
                            (item) => item.display_id === eventID,
                          )!
                          return (
                            <span className="published-event-evidence" key={eventID}>
                              {node.kind}: {eventTitle(node)} <code>{node.display_id}</code>
                            </span>
                          )
                        })
                      : 'Unavailable in this publication'}
                  </dd>
                </div>
                <div>
                  <dt>Provider check</dt>
                  <dd>{stamp(data.health.last_success_at)}</dd>
                </div>
                <div>
                  <dt>Canonical observation cutoff</dt>
                  <dd>{stamp(data.canonical?.cutoff || null)}</dd>
                </div>
                <div>
                  <dt>Processed facts version</dt>
                  <dd>
                    <code>{data.facts_version}</code>
                  </dd>
                </div>
                <div>
                  <dt>Display package version</dt>
                  <dd>
                    <code>{pkg.manifest.display_version}</code>
                  </dd>
                </div>
                <div>
                  <dt>Display build</dt>
                  <dd>
                    {stamp(pkg.manifest.generated_at)}
                    <small>Build time is separate from source freshness.</small>
                  </dd>
                </div>
                <div>
                  <dt>Displayed window</dt>
                  <dd>
                    {data.coverage.window_from} to {data.coverage.window_through} UTC, plus
                    source-reported running matches.
                  </dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    {data.coverage.displayed} processed cards; {data.coverage.clipped} eligible
                    records clipped; {data.coverage.outside_window} retained records outside this
                    window.
                  </dd>
                </div>
                <div>
                  <dt>Source check scope</dt>
                  <dd>
                    <Scope data={data} />
                  </dd>
                </div>
              </dl>
              <details className="published-source-record">
                <summary>
                  Inspect processed display evidence <ChevronRight size={14} />
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      card: pkg.providers[data.provider].cards.find(
                        (item) => item.display_id === id,
                      ),
                      canonical: data.canonical,
                      ...(data.schema_version === 'arena-live-display-2.0'
                        ? { calendar: data.calendar, publication: data.publication }
                        : {}),
                      health: data.health,
                      coverage: data.coverage,
                      display_version: pkg.manifest.display_version,
                      package_fingerprint: pkg.manifest.package_fingerprint,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </section>
            <p className="live-footnote">
              {openCanonical
                ? 'This view supplies current announcements. AI questions are available only through an explicitly associated validated record.'
                : 'This page supplies processed cards, not full provider tables, revision history, a live round feed or public AI.'}{' '}
              Derived display identities cannot be used as canonical agent contexts.
            </p>
            <p className="live-attribution">
              <a href={data.attribution.url} target="_blank" rel="noreferrer">
                {data.attribution.text}
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </p>
          </div>
        </>
      )}
    </dialog>
  )
}
function eventTitle(node: DirectoryNode) {
  const title = node.full_name || node.name || node.label,
    suffix = [node.season, node.year === null ? null : String(node.year)].filter(
      (part): part is string =>
        !!part && !title.toLocaleLowerCase('en').includes(part.toLocaleLowerCase('en')),
    )
  return [title, ...new Set(suffix)].join(' · ')
}
function EventDirectory({
  data,
  filters,
  setFilters,
}: {
  data: DisplayView
  filters: LiveFilters
  setFilters: PublishedWorkspaceProps['setFilters']
}) {
  const [page, setPage] = useState(0),
    nodes = useMemo(
      () => new Map(data.directory_nodes.map((node) => [node.display_id, node])),
      [data],
    ),
    selected = nodes.get(filters.event || ''),
    eligibleCards = useMemo(
      () => filterDisplayCards(data.cards, { ...filters, event: '' }, data.directory_nodes),
      [data, filters],
    ),
    children = data.directory_nodes
      .filter((node) =>
        selected ? node.parent_id === selected.display_id : node.parent_id === null,
      )
      .sort(
        (a, b) =>
          eventTitle(a).localeCompare(eventTitle(b), 'en') ||
          a.display_id.localeCompare(b.display_id),
      ),
    crumbs: DirectoryNode[] = []
  let parent = selected
  while (parent) {
    crumbs.unshift(parent)
    parent = nodes.get(parent.parent_id || '')
  }
  useEffect(() => setPage(0), [filters.event, data.provider])
  const choose = (id: string) => setFilters({ event: id, page: 0 })
  return (
    <section className="published-directory" aria-label="Observed event directory">
      <div className="published-directory-heading">
        <h2>Observed events</h2>
        <span>
          {data.directory_status === 'not_supplied'
            ? 'Event metadata unavailable'
            : `${data.directory_nodes.length} supplied nodes · displayed-card scope`}
        </span>
      </div>
      {data.directory_status === 'not_supplied' ? (
        <p className="published-directory-unavailable">
          {data.schema_version === 'arena-live-display-1.0'
            ? 'Match-only source publication. '
            : ''}
          Event hierarchy and unresolved-announcement coverage are unavailable in this publication.
        </p>
      ) : (
        <>
          <nav className="published-breadcrumbs" aria-label="Observed event breadcrumbs">
            <button onClick={() => choose('')}>All observed events</button>
            {crumbs.map((node) => (
              <span key={node.display_id}>
                <ChevronRight size={12} />
                <button
                  aria-current={node.display_id === selected?.display_id ? 'page' : undefined}
                  onClick={() => choose(node.display_id)}
                >
                  {eventTitle(node)}
                </button>
              </span>
            ))}
          </nav>
          {selected && (
            <div className="published-event-detail">
              <span className="sports-kicker">{selected.kind} · supplied source metadata</span>
              <h3>{eventTitle(selected)}</h3>
              <p>
                {selected.name && selected.name !== eventTitle(selected)
                  ? `Source name: ${selected.name} · `
                  : ''}
                {selected.identity_basis.replaceAll('_', ' ')}
                {selected.metadata_conflicted ? ' · conflicting metadata' : ''}
                {selected.parent_conflicted ? ' · conflicting parent; unassigned' : ''}
              </p>
              <code>{selected.display_id}</code>
              <button
                className="published-show-matches"
                onClick={() => setFilters({ tab: 'matches', page: 0 })}
              >
                Show matching announcements <ChevronRight size={14} />
              </button>
            </div>
          )}
          {!children.length && (
            <p className="published-directory-unavailable">
              {selected
                ? 'No child events supplied. Matching announcements are shown below.'
                : 'No source event metadata in the displayed-card scope.'}
            </p>
          )}
          <div className="published-event-list">
            {children.slice(page * 25, (page + 1) * 25).map((node) => {
              const cards = eligibleCards.filter((card) =>
                  cardInEvent(card, node.display_id, nodes),
                ),
                dates = cards
                  .map((card) => card.day_utc)
                  .filter((day): day is string => !!day)
                  .sort(),
                pending = cards.filter((card) => card.pending_reasons.length > 0).length
              return (
                <button
                  className="published-event-row"
                  key={node.display_id}
                  aria-label={`Open observed ${node.kind} ${eventTitle(node)}, ${node.display_id}`}
                  onClick={() => choose(node.display_id)}
                >
                  <span>
                    <small>
                      {node.kind}
                      {!node.parent_id && ['series', 'tournament'].includes(node.kind)
                        ? ' · unassigned source event'
                        : ''}
                    </small>
                    <b>{eventTitle(node)}</b>
                    <small>
                      {node.display_id.slice(-8)}
                      {node.metadata_conflicted ? ' · metadata conflict' : ''}
                      {node.parent_conflicted ? ' · parent conflict' : ''}
                    </small>
                  </span>
                  <span className="published-event-count">
                    <b>{cards.length} matching displayed</b>
                    <small>
                      {pending} pending ·{' '}
                      {dates.length ? `${dates[0]} – ${dates.at(-1)} UTC` : 'Dates unavailable'}
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              )
            })}
          </div>
          {children.length > 25 && (
            <nav className="live-pagination" aria-label="Observed event pagination">
              <span>
                {page * 25 + 1}–{Math.min((page + 1) * 25, children.length)} of {children.length}{' '}
                observed events
              </span>
              <div>
                <button
                  aria-label="Previous observed events"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  aria-label="Next observed events"
                  disabled={(page + 1) * 25 >= children.length}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </nav>
          )}
        </>
      )}
      <p className="published-directory-note">
        Events describe supplied entities referenced by this bounded publication. Dates span
        confirmed UTC announcements, not an official event schedule.
      </p>
    </section>
  )
}
export default function PublishedLiveWorkspace({
  provider,
  filters,
  selectedMatch,
  refresh,
  setProvider,
  setFilters,
  openMatch,
  closeMatch,
  openCanonical,
}: PublishedWorkspaceProps) {
  const { data: pkg, error, loading } = usePublishedDisplay(refresh),
    data = useMemo(() => (pkg ? displayView(pkg.providers[provider]) : undefined), [pkg, provider]),
    dateError = dateFilterError(filters),
    [now, setNow] = useState(Date.now()),
    [dateFiltersOpen, setDateFiltersOpen] = useState(() => !!dateError)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (dateError) setDateFiltersOpen(true)
  }, [dateError, filters.from, filters.through])
  const stale = !!data && (displayStale(data, now) || !!error),
    matched = useMemo(
      () => filterDisplayCards(data?.cards || [], filters, data?.directory_nodes || []),
      [data, filters],
    ),
    cards = matched.slice(filters.page * 25, (filters.page + 1) * 25)
  useEffect(() => {
    const max = Math.max(0, Math.ceil(matched.length / 25) - 1)
    if (filters.page > max) setFilters({ page: max }, true)
  }, [matched.length, filters.page])
  const groups = useMemo(() => {
    const values = new Map<string, DisplayCard[]>()
    for (const card of cards) {
      const day = card.day_utc || 'unresolved'
      values.set(day, [...(values.get(day) || []), card])
    }
    return values
  }, [cards])
  return (
    <div className="live-workspace published-workspace" data-live-provider={provider}>
      <div className="sports-heading live-heading">
        <div>
          <span className="sports-kicker">FIXTURES &amp; RESULTS / FOOTBALL &amp; ESPORTS</span>
          <h1>
            Current matches<span>.</span>
          </h1>
          <p>Upcoming fixtures and recent results, with source check times.</p>
        </div>
        <span className="live-heading-mark">
          <Activity size={24} />
        </span>
      </div>
      <div
        className="live-provider-tabs"
        role="group"
        aria-label="Select published current provider"
      >
        {(['football-data', 'pandascore'] as LiveProvider[]).map((key) => (
          <button
            key={key}
            aria-pressed={provider === key}
            aria-label={`${liveProviders[key].label} published provider ${liveProviders[key].name}`}
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
      <div className="live-source-limit">
        <Clock3 size={16} />
        <span>
          {provider === 'football-data'
            ? 'Delayed football scores'
            : 'VALORANT series scores · match-level coverage'}
        </span>
      </div>
      <div className="published-view-tabs" role="group" aria-label="Current directory view">
        {(['matches', 'events'] as const).map((tab) => (
          <button
            key={tab}
            aria-pressed={(filters.tab || 'matches') === tab}
            onClick={() => setFilters({ tab, page: 0 })}
          >
            {tab === 'matches' ? 'Matches' : 'Events'}
          </button>
        ))}
        {openCanonical && (
          <button
            className="published-canonical-tools"
            onClick={() => setFilters({ workspace: 'canonical', page: 0 })}
          >
            Validated record tools
          </button>
        )}
      </div>
      {error && (
        <p className="published-warning" role="alert">
          {error}
          {pkg ? ' Showing the last verified display package.' : ''}
        </p>
      )}
      {!pkg ? (
        <section className="live-unavailable" aria-label="Published display unavailable">
          <h2>
            {loading ? 'Verifying published current matches…' : 'Published display unavailable.'}
          </h2>
          <p>
            No processed publication has been accepted. Stored synthetic or CC0 records are never
            substituted here.
          </p>
        </section>
      ) : (
        data && (
          <>
            <section
              className={`live-health ${stale ? 'is-stale' : ''}`}
              aria-label="Published source health"
              aria-busy={loading}
            >
              <div className="live-health-heading">
                <div>
                  <Radio size={15} />
                  <h2>Source collection</h2>
                </div>
                <span className={`live-health-badge ${stale ? 'is-stale' : ''}`}>
                  {error
                    ? 'Refresh failed · verified display retained'
                    : stale
                      ? 'Stale source check'
                      : data.health.state === 'ready'
                        ? 'Recent source check'
                        : data.health.state.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="published-check-summary">
                Checked {stamp(data.health.last_success_at)}
              </p>
              <p className="published-window-summary">
                UTC {data.coverage.window_from}–{data.coverage.window_through} ·{' '}
                {data.coverage.displayed}/{data.coverage.eligible_total} eligible announcements
                displayed
                {data.coverage.clipped > 0 ? ` · ${data.coverage.clipped} clipped` : ''}
                {data.coverage.pending_displayed !== null
                  ? ` · ${data.coverage.pending_displayed} pending`
                  : ''}
                {data.coverage.unknown_utc_total !== null
                  ? ` · ${data.coverage.unknown_utc_total} unresolved UTC dates`
                  : ''}
              </p>
              <details className="live-health-evidence">
                <summary>
                  Inspect published collection evidence <ChevronRight size={14} />
                </summary>
                <dl className="live-provenance">
                  <div>
                    <dt>Last successful source check</dt>
                    <dd>{stamp(data.health.last_success_at)}</dd>
                  </div>
                  <div>
                    <dt>Canonical observation cutoff</dt>
                    <dd>{stamp(data.canonical?.cutoff || null)}</dd>
                  </div>
                  <div>
                    <dt>Calendar observation cutoff</dt>
                    <dd>
                      {stamp(data.calendar?.cutoff || null)}
                      <small>Calendar and canonical observations remain independent.</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Completed collection / selection</dt>
                    <dd>
                      {stamp(data.publication?.collected_at || null)} /{' '}
                      {stamp(data.publication?.selected_at || null)}
                    </dd>
                  </div>
                  <div>
                    <dt>Calendar facts / dataset</dt>
                    <dd>
                      {data.calendar ? (
                        <code>
                          {data.calendar.facts_version} / {data.calendar.dataset_version}
                        </code>
                      ) : (
                        'Unavailable in this publication'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Pending / unresolved UTC dates</dt>
                    <dd>
                      {data.coverage.pending_total === null
                        ? 'Unavailable in this publication'
                        : `${data.coverage.pending_total} retained pending / ${data.coverage.unknown_utc_total} eligible unresolved dates`}
                    </dd>
                  </div>
                  <div>
                    <dt>Processed window</dt>
                    <dd>
                      {data.coverage.window_from} to {data.coverage.window_through} UTC
                    </dd>
                  </div>
                  <div>
                    <dt>Displayed / eligible / retained</dt>
                    <dd>
                      {data.coverage.displayed} / {data.coverage.eligible_total} /{' '}
                      {data.coverage.retained_total}
                      <small>
                        Counts describe retained input and this window, not complete provider
                        coverage.
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Clipped / outside window</dt>
                    <dd>
                      {data.coverage.clipped} / {data.coverage.outside_window}
                    </dd>
                  </div>
                  <div>
                    <dt>Last changed publication</dt>
                    <dd>{stamp(data.health.last_change_at)}</dd>
                  </div>
                  <div>
                    <dt>Last source attempt</dt>
                    <dd>{stamp(data.health.last_attempt_at)}</dd>
                  </div>
                  <div>
                    <dt>Source check scope</dt>
                    <dd>
                      <Scope data={data} />
                    </dd>
                  </div>
                  <div>
                    <dt>Current attempt scope</dt>
                    <dd>
                      <code>{JSON.stringify(data.health.attempt_scope)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Source health at display build</dt>
                    <dd>
                      {data.health.state.replaceAll('_', ' ')}
                      {data.health.serving_last_good ? ' · serving last-good source cards' : ''}
                      <small>{data.health.error_code || 'No source error reported'}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Processed facts / display</dt>
                    <dd>
                      <code>
                        {data.facts_version} / {pkg.manifest.display_version}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>Display generation</dt>
                    <dd>
                      {stamp(pkg.manifest.generated_at)}
                      <small>
                        Checksummed own-site files refresh every 60 seconds in this browser.
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Display fingerprint</dt>
                    <dd>
                      <code>{pkg.manifest.package_fingerprint}</code>
                    </dd>
                  </div>
                </dl>
              </details>
            </section>
            {filters.tab === 'events' && (
              <EventDirectory data={data} filters={filters} setFilters={setFilters} />
            )}
            <section className="live-board" aria-label="Published current match board">
              {filters.event && (
                <div className="published-selected-event" role="status">
                  <span>
                    {data.directory_nodes.some((node) => node.display_id === filters.event)
                      ? `Observed ${eventTitle(data.directory_nodes.find((node) => node.display_id === filters.event)!)}`
                      : 'Selected event is unavailable in this publication.'}
                  </span>
                  <button onClick={() => setFilters({ event: '', page: 0 })}>Clear event</button>
                </div>
              )}
              <div className="live-board-controls">
                <div className="live-status-tabs" role="group" aria-label="Published match status">
                  {(
                    [
                      ['running', 'Running'],
                      ['scheduled', 'Scheduled'],
                      ['finished', 'Finished'],
                      ['all', 'All statuses'],
                    ] as const
                  ).map(([status, label]) => (
                    <button
                      key={status}
                      aria-pressed={filters.status === status}
                      onClick={() => setFilters({ status, page: 0 })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="live-search">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label="Search published current matches"
                    placeholder="Teams or competition"
                    maxLength={100}
                    value={filters.search}
                    onChange={(event) => setFilters({ search: event.target.value, page: 0 })}
                  />
                </label>
              </div>
              <details
                className="published-date-filters"
                open={dateFiltersOpen}
                onToggle={(event) => setDateFiltersOpen(event.currentTarget.open)}
              >
                <summary>
                  UTC date filters
                  {filters.from || filters.through || filters.includeUnresolved === false
                    ? ' · active'
                    : ''}
                  <ChevronRight size={14} />
                </summary>
                <div className="published-date-inputs">
                  <label>
                    From{' '}
                    <input
                      type="date"
                      aria-label="Published UTC date from"
                      value={filters.from || ''}
                      onChange={(event) => setFilters({ from: event.target.value, page: 0 })}
                    />
                  </label>
                  <label>
                    Through{' '}
                    <input
                      type="date"
                      aria-label="Published UTC date through"
                      value={filters.through || ''}
                      onChange={(event) => setFilters({ through: event.target.value, page: 0 })}
                    />
                  </label>
                  <label className="published-unresolved-control">
                    <input
                      type="checkbox"
                      checked={filters.includeUnresolved !== false}
                      onChange={(event) =>
                        setFilters({ includeUnresolved: event.target.checked, page: 0 })
                      }
                    />
                    Include unresolved dates
                  </label>
                </div>
                <p>
                  Ranges compare confirmed UTC days only. Source dates and unzoned clocks remain
                  unresolved.
                </p>
                {dateError && (
                  <p className="published-date-error" role="alert">
                    {dateError}
                  </p>
                )}
              </details>
              <div className="live-board-summary">
                <span role="status">{matched.length.toLocaleString('en-GB')} matches</span>
                <span>
                  {liveProviders[provider].label} · {matched.filter((card) => !card.day_utc).length}{' '}
                  unresolved dates
                </span>
              </div>
              {!cards.length ? (
                <div className="live-empty">
                  <Activity size={25} />
                  <h2>
                    {data.canonical
                      ? filters.status === 'running' && !filters.search
                        ? 'No running cards in this published window.'
                        : 'No cards match these display filters.'
                      : 'No verified source cards are available.'}
                  </h2>
                  <p>
                    {data.canonical
                      ? 'The window is bounded; an empty filter does not establish complete provider coverage.'
                      : `Source state: ${data.health.state.replaceAll('_', ' ')}. No substitute data is displayed.`}
                  </p>
                </div>
              ) : (
                <div className="live-date-groups">
                  {Array.from(groups).map(([day, rows]) => (
                    <section
                      key={day}
                      className="live-date-group"
                      aria-label={`Published current matches ${day}`}
                    >
                      <header>
                        {day === 'unresolved' ? (
                          <span>Unresolved UTC dates</span>
                        ) : (
                          <CalendarDate day={day} />
                        )}
                        <span>{rows.length} on this page</span>
                      </header>
                      {rows.map((card) => (
                        <button
                          key={card.display_id}
                          data-display-id={card.display_id}
                          className="live-match-row"
                          aria-label={`Inspect published match ${rival(card.team_a)} vs ${rival(card.team_b)}, ${kickoffText(card)}`}
                          onClick={() => openMatch(card.display_id)}
                        >
                          <span className="live-row-time">
                            <b>
                              {card.kickoff_label
                                ? card.kickoff_label.slice(0, 5)
                                : card.kickoff_precision === 'source_date'
                                  ? card.kickoff_source_text
                                  : 'Unknown'}
                            </b>
                            <small>
                              {card.kickoff_precision === 'utc'
                                ? 'UTC'
                                : card.kickoff_precision === 'source_date'
                                  ? 'Source date · time unavailable'
                                  : card.kickoff_precision === 'timezone_unknown'
                                    ? 'Timezone unknown'
                                    : 'Date unavailable'}
                              {provider === 'pandascore'
                                ? ` · ${card.series_format || 'Format unavailable'}`
                                : ''}
                            </small>
                          </span>
                          <span className="live-row-teams">
                            <span>
                              {card.team_a ? (
                                <Monogram name={card.team_a.label} />
                              ) : (
                                <span className="published-pending-mark">?</span>
                              )}
                              <b>{rival(card.team_a)}</b>
                            </span>
                            <span>
                              {card.team_b ? (
                                <Monogram name={card.team_b.label} />
                              ) : (
                                <span className="published-pending-mark">?</span>
                              )}
                              <b>{rival(card.team_b)}</b>
                            </span>
                          </span>
                          <span
                            className="live-row-score"
                            aria-label={
                              card.score_label
                                ? `${card.result_state} ${liveProviders[provider].unit} ${card.score_label}`
                                : 'Published score unavailable'
                            }
                          >
                            <b>{card.score_label?.split('–')[0] || '—'}</b>
                            <b>{card.score_label?.split('–')[1] || '—'}</b>
                          </span>
                          <span className="live-row-context">
                            <b>{card.competition_label}</b>
                            <span className="live-match-status">
                              {card.status_label}
                              {card.result_state === 'provisional' ? ' · provisional' : ''}
                              {card.result_state === 'source_reported' ? ' · source reported' : ''}
                              {['pending', 'conflicted'].includes(card.resolution)
                                ? ` · ${card.resolution}`
                                : ''}
                            </span>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              )}
              {matched.length > 25 && (
                <nav className="live-pagination" aria-label="Published match pagination">
                  <span>
                    Showing {filters.page * 25 + 1}–
                    {Math.min((filters.page + 1) * 25, matched.length)} of {matched.length}
                  </span>
                  <div>
                    <button
                      aria-label="Previous published matches page"
                      disabled={!filters.page}
                      onClick={() => setFilters({ page: filters.page - 1 })}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>
                      Page {filters.page + 1} of {Math.ceil(matched.length / 25)}
                    </span>
                    <button
                      aria-label="Next published matches page"
                      disabled={(filters.page + 1) * 25 >= matched.length}
                      onClick={() => setFilters({ page: filters.page + 1 })}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </nav>
              )}
            </section>
            <p className="live-attribution">
              <a href={data.attribution.url} target="_blank" rel="noreferrer">
                {data.attribution.text}
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </p>
            <div className="live-data-boundary">
              <ShieldCheck size={17} />
              <p>
                {data.license_note}{' '}
                <a href={data.attribution.terms_url} target="_blank" rel="noreferrer">
                  Provider terms <ArrowUpRight size={12} />
                </a>
              </p>
            </div>
            {selectedMatch && (
              <PublishedDetail
                key={`${provider}:${selectedMatch}`}
                id={selectedMatch}
                data={data}
                pkg={pkg}
                close={closeMatch}
                stale={stale}
                openCanonical={openCanonical}
              />
            )}
          </>
        )
      )}
    </div>
  )
}
function CalendarDate({ day }: { day: string }) {
  return (
    <time dateTime={day}>
      {new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${day}T00:00:00Z`))}
    </time>
  )
}
