import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  FileText,
  Globe2,
  Layers3,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import type {
  OpenFootballConnection,
  OpenFootballMatch,
  OpenFootballSnapshot,
  OpenFootballTeam,
} from '../openFootball'
import { resultLabel, searchText, sourceClock, sourceDay } from '../openFootball'
import { Monogram, SourceAnchor } from './openFootballShared'
import { ResearchQuestion } from './ResearchQuestion'

const number = (value: number) => value.toLocaleString('en-GB')
const typeLabel = (value: string) => (value === 'national' ? 'National team' : 'Club')

export function SourceTeams({
  data,
  openTeam,
}: {
  data: OpenFootballSnapshot
  openTeam: (id: string) => void
}) {
  const [query, setQuery] = useState(''),
    [region, setRegion] = useState(''),
    [kind, setKind] = useState(''),
    [visibleLimit, setVisibleLimit] = useState(30)
  const teams = data.teams || []
  const filtered = teams
    .filter(
      (team) =>
        (!query ||
          searchText(`${team.team_name} ${team.team_namespace} ${team.team_id}`).includes(
            searchText(query),
          )) &&
        (!region || team.region === region) &&
        (!kind || team.team_type === kind),
    )
    .sort(
      (a, b) => a.team_name.localeCompare(b.team_name, 'en') || a.team_id.localeCompare(b.team_id),
    )
  const regions = Array.from(new Set(teams.map((team) => team.region))).sort()
  function resetLimit() {
    setVisibleLimit(30)
  }
  return (
    <section className="of-team-directory" aria-label="Source team directory">
      <div className="of-team-directory-heading">
        <div>
          <span className="sports-kicker">SOURCE IDENTITIES / IMPORTED COVERAGE</span>
          <h2>
            Follow the team<span>.</span>
          </h2>
          <p>Clubs and national teams in the accepted source records.</p>
        </div>
        <span>
          <UsersRound size={18} />
          <b>{number(teams.length)}</b> source teams
        </span>
      </div>
      <div className="of-team-directory-note">
        <ShieldCheck size={16} />
        <p>
          Profiles use source-derived IDs and reviewed namespaces. Names and record coverage do not
          establish official club or federation identities.
        </p>
      </div>
      <div className="of-team-directory-filters">
        <label>
          <span>Search source teams</span>
          <span className="of-input-icon">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search source teams"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                resetLimit()
              }}
              placeholder="Team name or source ID"
            />
          </span>
        </label>
        <label>
          <span>Region</span>
          <select
            aria-label="Filter source teams by region"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value)
              resetLimit()
            }}
          >
            <option value="">All source regions</option>
            {regions.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Team type</span>
          <select
            aria-label="Filter source teams by type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value)
              resetLimit()
            }}
          >
            <option value="">Clubs and national teams</option>
            <option value="club">Clubs</option>
            <option value="national">National teams</option>
          </select>
        </label>
      </div>
      <div className="of-team-directory-count" role="status">
        {number(filtered.length)} matching source {filtered.length === 1 ? 'team' : 'teams'}
      </div>
      {!teams.length ? (
        <div className="of-empty">
          <CircleHelp size={25} />
          <h3>Team profiles are not included in this package.</h3>
          <p>
            The existing match records remain available. Import a research package with source team
            profiles to use this directory.
          </p>
        </div>
      ) : !filtered.length ? (
        <div className="of-empty">
          <Search size={25} />
          <h3>No imported teams for this filter.</h3>
          <p>Try another name, region or team type.</p>
        </div>
      ) : (
        <div className="of-source-team-grid">
          {filtered.slice(0, visibleLimit).map((team) => (
            <TeamCard key={team.team_id} team={team} openTeam={openTeam} />
          ))}
        </div>
      )}
      {filtered.length > visibleLimit && (
        <div className="of-team-load-more">
          <span>
            Showing {visibleLimit} of {number(filtered.length)} teams
          </span>
          <button
            className="button button-secondary"
            onClick={() => setVisibleLimit(visibleLimit + 30)}
          >
            Show more source teams
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </section>
  )
}
function TeamCard({ team, openTeam }: { team: OpenFootballTeam; openTeam: (id: string) => void }) {
  return (
    <button
      className="of-source-team-card"
      onClick={() => openTeam(team.team_id)}
      aria-label={`Inspect source team ${team.team_name}`}
    >
      <div>
        <Monogram name={team.team_name} />
        <span>
          <small>
            {typeLabel(team.team_type)} · {team.region}
          </small>
          <b>{team.team_name}</b>
        </span>
        <ArrowUpRight size={15} />
      </div>
      <p>
        <b>{number(team.record_count)}</b> source records
        <span>
          {team.edition_ids.length} {team.edition_ids.length === 1 ? 'edition' : 'editions'}
        </span>
      </p>
      <div className="of-team-card-coverage">
        <span>{number(team.observed_results)} observed</span>
        <span>{number(team.unknown_results)} unknown</span>
      </div>
      <small className="of-team-card-namespace">{team.team_namespace}</small>
    </button>
  )
}

export function SourceTeamProfile({
  data,
  connection,
  id,
  back,
  openTeam,
  openEdition,
  openMatch,
  viewRecords,
}: {
  data: OpenFootballSnapshot
  connection: OpenFootballConnection
  id: string
  back: () => void
  openTeam: (id: string) => void
  openEdition: (id: string) => void
  openMatch: (id: string) => void
  viewRecords: (id: string) => void
}) {
  const profile = data.team_profiles?.find((team) => team.team_id === id)
  const matchIndex = useMemo(
    () => new Map(data.matches.map((match) => [match.match_id, match])),
    [data],
  )
  if (!profile)
    return (
      <section className="of-team-profile" aria-label="Source team profile">
        <button className="of-back-link" onClick={back}>
          <ArrowLeft size={14} />
          Back to source teams
        </button>
        <div className="of-empty" role="status">
          <CircleHelp size={26} />
          <h2>Source team unavailable.</h2>
          <p>
            This stable ID is not included in the accepted team profile package. No other team was
            selected as a substitute.
          </p>
          <code>{id}</code>
        </div>
      </section>
    )
  const recent = profile.recent_match_ids
    .map((matchId) => matchIndex.get(matchId))
    .filter((match): match is OpenFootballMatch => !!match)
  const sources = data.sources.filter((source) => profile.edition_ids.includes(source.source_id))
  return (
    <section className="of-team-profile" aria-label="Source team profile">
      <button className="of-back-link" onClick={back}>
        <ArrowLeft size={14} />
        Back to source teams
      </button>
      <div className="of-source-profile-heading">
        <Monogram name={profile.team_name} large />
        <div>
          <span className="sports-kicker">
            {typeLabel(profile.team_type).toUpperCase()} / {profile.region.toUpperCase()}
          </span>
          <h2>
            {profile.team_name}
            <span>.</span>
          </h2>
          <p>{profile.team_namespace} · Source-derived identity</p>
        </div>
        <span className="of-profile-seal">
          <ShieldCheck size={20} />
          IMPORTED
          <br />
          EVIDENCE
        </span>
      </div>
      <div className="of-profile-counters">
        <div>
          <span>Imported records</span>
          <b>{number(profile.record_count)}</b>
          <small>Current accepted source rows</small>
        </div>
        <div>
          <span>Observed results</span>
          <b>{number(profile.observed_results)}</b>
          <small>Source scores available</small>
        </div>
        <div>
          <span>Unknown results</span>
          <b>{number(profile.unknown_results)}</b>
          <small>Missing scores remain unknown</small>
        </div>
        <div>
          <span>Imported editions</span>
          <b>{profile.edition_ids.length}</b>
          <small>Within this source identity</small>
        </div>
      </div>
      <div className="of-profile-note">
        <ShieldCheck size={16} />
        <p>Imported coverage only. Source score stages do not define an official team record.</p>
      </div>
      <div className="of-profile-grid">
        <div className="of-profile-history">
          <div className="of-section-heading">
            <div>
              <h3>Recent source records</h3>
              <p>
                Latest {recent.length} of {number(profile.record_count)} records · source
                calendar-date order
              </p>
            </div>
            <button onClick={() => viewRecords(profile.team_id)}>
              View all team records
              <ArrowRight size={14} />
            </button>
          </div>
          {recent.length ? (
            <div>
              {recent.map((match) => (
                <ProfileMatch
                  key={match.match_id}
                  match={match}
                  teamId={profile.team_id}
                  openMatch={openMatch}
                  openTeam={openTeam}
                />
              ))}
            </div>
          ) : (
            <div className="of-empty">
              <FileText size={25} />
              <p>No recent records were included for this team.</p>
            </div>
          )}
          <p className="of-helper">
            Latest source scores and opponents describe imported evidence, not pre-match
            availability or model performance.
          </p>
        </div>
        <aside className="of-profile-sidebar" aria-label="Source team context">
          <ResearchQuestion
            key={profile.team_id}
            data={data}
            connection={connection}
            context={{ kind: 'team', id: profile.team_id, label: profile.team_name }}
          />
          <section>
            <div className="of-section-heading">
              <h3>Imported editions</h3>
              <Layers3 size={16} />
            </div>
            {profile.editions.map((edition) => (
              <button
                key={edition.edition_id}
                className="of-profile-edition"
                onClick={() => openEdition(edition.edition_id)}
                aria-label={`Inspect source edition ${edition.name}, ${edition.season}`}
              >
                <b>{edition.name}</b>
                <small>{edition.season}</small>
                <span>
                  {number(edition.record_count)} records · {number(edition.observed_results)}{' '}
                  observed
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </section>
          <section>
            <div className="of-section-heading">
              <h3>Identity & coverage</h3>
              <Globe2 size={16} />
            </div>
            <dl>
              <div>
                <dt>Source identity</dt>
                <dd>
                  <code>{profile.team_id}</code>
                </dd>
              </div>
              <div>
                <dt>Namespace</dt>
                <dd>{profile.team_namespace}</dd>
              </div>
              <div>
                <dt>Latest source date</dt>
                <dd>{sourceDay(profile.latest_source_date)}</dd>
              </div>
              <div>
                <dt>Team type</dt>
                <dd>{typeLabel(profile.team_type)}</dd>
              </div>
            </dl>
            <p>
              {profile.coverage_note} Namespaced source IDs keep ambiguous names apart. Source FT
              can include ambiguous score semantics; no global wins, draws or losses are inferred.
            </p>
          </section>
          <section>
            <div className="of-section-heading">
              <h3>Source files</h3>
              <FileText size={16} />
            </div>
            {sources.map((source) => {
              const row = data.matches.find((match) => match.source_id === source.source_id)
              return (
                <div className="of-profile-source" key={source.source_id}>
                  <SourceAnchor href={row?.source_url}>{source.path}</SourceAnchor>
                  <small>{source.source_ref || 'Reference unavailable'}</small>
                </div>
              )
            })}
            <p>CC0-1.0 community data. Current accepted imports, with collection provenance.</p>
          </section>
        </aside>
      </div>
    </section>
  )
}
function ProfileMatch({
  match,
  teamId,
  openMatch,
  openTeam,
}: {
  match: OpenFootballMatch
  teamId: string
  openMatch: (id: string) => void
  openTeam: (id: string) => void
}) {
  const isA = match.team_a_id === teamId,
    opponent = isA ? match.team_b : match.team_a,
    opponentId = isA ? match.team_b_id : match.team_a_id
  return (
    <article className="of-profile-match">
      <div className="of-profile-match-date">
        <b>{sourceDay(match.source_date)}</b>
        <small>{match.round || 'Round not supplied'}</small>
      </div>
      <div className="of-profile-opponent">
        <Monogram name={opponent} />
        <span>
          <small>{isA ? 'Source side A · vs' : 'Source side B · vs'}</small>
          <button
            onClick={() => openTeam(opponentId)}
            aria-label={`Inspect source team ${opponent}`}
          >
            {opponent}
            <ArrowUpRight size={12} />
          </button>
        </span>
      </div>
      <button
        className="of-profile-inspect-match"
        onClick={() => openMatch(match.match_id)}
        aria-label={`Inspect open match ${match.team_a} vs ${match.team_b}, ${match.source_date}`}
      >
        <b>
          {match.result_status === 'observed_result'
            ? `${match.score_a} – ${match.score_b}`
            : '— – —'}
        </b>
        <span>{resultLabel(match)}</span>
        {match.result_status === 'observed_result' && <small>Source A–B score</small>}
        <ChevronSymbol />
      </button>
      <p>
        {match.competition} · {match.season}
        <span>{sourceClock(match)}</span>
      </p>
    </article>
  )
}
function ChevronSymbol() {
  return <ArrowRight size={13} />
}
