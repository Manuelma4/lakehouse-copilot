# Source football research: editions, matches and teams

The real-data workspace is a separate, source-aware product inside Arena. The synthetic showcase and its stored forecasts retain their own navigation, contracts and provenance. Opening a research profile never substitutes a synthetic team or model answer.

## Research navigation

- **Match records** retains the edition directory, region/search/calendar-date/result filters and 25-record pagination. Exact source group and round selectors contain only supplied labels. Edition participants link to stable source team IDs. Results missing from an old source date remain **Result unknown**.
- **Source teams** lists clubs and national teams with region/type/name filters and bounded rendering. Namespaced IDs distinguish identities; the application does not claim that these IDs belong to an official registry.
- **Team profiles** show imported record, observed-result, unknown-result and edition counts. Recent records are the supplied subset of at most 25 match IDs, ordered by source calendar date. Opponents, edition links and record details are actionable. **View all team records** opens the full team-filtered match center with ordinary pagination.
- Query parameters `research_edition`, `research_match`, `research_team`, `research_section` and `research_team_filter` preserve research scope through reload and browser navigation. `research_group`, `research_round`, `research_search`, `research_region`, `research_date` and `research_status` preserve combined record filters. They are independent of the synthetic competition/match/team routes.

Profiles report coverage rather than global wins/draws/losses. The source FT field is not guaranteed to be a regulation-time result; FT, HT, ET and penalty fields remain distinct. No official standings, rosters, xG, brackets or real-team predictions are inferred.

## Clock and World Cup metadata

The loader accepts research contracts 1.0 and 2.0. Version 1 records retain date-only or unresolved local-minute precision. Version 2 can also carry an explicit numeric offset and an offset-derived UTC kickoff.

| Source precision | Presentation |
| --- | --- |
| `date_only` | Source calendar date; **Time unavailable**; no UTC instant. |
| `local_minute` | Source local clock; **Timezone unresolved**; no UTC instant. |
| `offset_minute` | Original source date/clock and supplied UTC offset, plus a separate **Offset-derived UTC** field in match detail. No IANA timezone is assumed. |

Optional source match number, source group and ground are displayed as supplied; missing values say **Not supplied**. A numeric offset does not establish match completion time or historical availability. Completed-at remains unknown and every research row is prediction-ineligible.

## Exact source filters and collection coverage

Group and round filtering applies before the matching count, source-date ordering and 25-row pagination. Labels are exact source values; no bracket, official table or inferred stage is added. An unknown URL label yields no records and an explicit missing-label notice. Older packages without groups remain usable, with the group selector disabled. Filtering a team uses its stable source-derived ID.

The API accepts additive `source_group` and `round` parameters on research match, edition-detail and team-detail routes. Exact values are bound query parameters, with a 120-character transport limit. Ordering is source calendar date, ascending supplied local clock and stable match ID. It does not infer a kickoff instant from an unresolved clock.

Each selected edition has a **Collection & coverage** panel. Its counts describe the full imported edition, independently of visible group, round, team, date and result filters. The panel distinguishes four dates:

| Field | Meaning |
| --- | --- |
| Last successful source check | Latest packaged successful poll for this source. A check can contain zero changed records. Failed attempts are not represented in the package. |
| Latest included result date | Latest source calendar date with an accepted score. It is neither publication time nor match completion time. |
| Latest included match observation | Latest collection timestamp of the current accepted match revisions. An unchanged source check need not advance it. |
| Package cutoff | The verified package's overall observation cutoff, which can be later than this edition's check. |

Collection evidence also exposes the included successful-check count, check outcome, date-only/local-minute/explicit-offset counts, current reviewed source reference, last checked content checksum and source path. UTC collection clocks include seconds. A supplied moving reference such as `master` retains its source value and is explicitly distinguished from a pinned commit. An absent reference says **Not pinned**. Missing poll evidence says **Not included**; it is never replaced by a match observation or the browser's current time. Supplied poll records are validated before display, including source identity, UTC time, counters, checksum, status and unique poll ID.

The unchanged `20d06e8e5af0886e` package provides concrete acceptance anchors: **Group A** has six records, **Round of 32** has sixteen, and Mexico has three Group A appearances. Colombia has 200 imported records, 167 accepted results and 33 unknown results. Its latest included result date is **4 May 2025**, despite a successful source check on **6 October 2026**. Those unknown scores remain unknown, rather than becoming upcoming matches.

The implementation check passed four new Python query/API regressions, all eighteen existing research/v1 tests, Ruff, TypeScript/Vite build and formatting. A focused browser run passed **8/8 applicable executions** in **41.4 seconds**, with zero retries and one intentional local skip: the malformed public-response fixture only applies to public mode. The live desktop, public desktop and Pixel 7 journeys checked combined filters, reload/back/forward, stable Mexico navigation, pagination reset, full-edition coverage, and rejection of invalid collection evidence. Public journeys issued no API requests, and no uncaught browser errors were observed. This is a focused functional check, rather than a full regression or repeated stability claim.

Actual new captures and the successful report are retained under `data/groups-qa-02/`; the first diagnostic remains under `data/groups-diagnostic-01/`. The diagnostic exposed absent generated assets and Vite font restrictions caused by a temporary dependency junction, plus a test expectation that incorrectly treated the supplied `master` reference as absent. Those were corrected before the measured run. No immutable fixture bytes changed.

The desktop **source-round** capture shows the sixteen supplied Round of 32 records and the native filter hierarchy; **source-coverage** shows Colombia's October source check alongside its May result date. On the actual Pixel 7 viewport, coverage metrics reflow into two columns, group and round selectors remain usable, and source-clock/score rows wrap without document overflow. Collection detail remains an explicit disclosure. Ordinary vertical scrolling is needed when all filters or provenance fields are expanded. Previous v0.5 screenshots below describe the earlier milestone.

## Questions and evidence

Collapsed **Ask about this match/team/edition** panels submit exactly one context ID. The local route is `/open-football/chat`, with its own trace identity and `/open-football/feedback` ledger. The client checks the response provider, data kind, dataset version, fingerprint and requested mode before displaying it. A failed requested local model is shown as an error, without silently switching to another mode or dataset.

Public mode never calls those endpoints. It provides a labelled **Deterministic source summary** over the accepted package, bounded structured evidence and source references. Unsupported questions abstain; forecast requests explain why the package cannot support them. Browser evidence IDs are temporary and public feedback is unavailable.

## Interaction and rendering

The dataset and research component load only on entering Open football. Match pages render 25 rows, the team directory initially renders 30 cards, and profiles resolve recent IDs from the shared match index rather than duplicating rows. Team names wrap; original monograms avoid licensed logos. Source links are restricted to the reviewed OpenFootball/CC0 hosts.

The record drawer uses a native modal dialog with an explicit accessible title, Escape handling and focus return. Filters have native labels; mobile filters collapse without hiding the result-status controls. Team navigation uses buttons with stable IDs, never display-name equality. Loading, unavailable source packages and missing profile IDs have explicit states.

The initial v2 smoke used the actual `20d06e8e5af0886e` package: 2,831 records, 261 source teams and 104 numeric-offset records. Public desktop/mobile checks verified source-only summaries, forecast abstention, UTC date rollover, zero API requests and no horizontal overflow. Local evidence/feedback checks used the separate research endpoints, and team profile back/reload resolved the same stable ID. TypeScript/Vite build and source formatting passed. Independent browser QA is reported separately.

Actual viewport captures from the smoke are retained in `C:\Works\.arena-artifacts\worldcup\`:

- `team-directory-desktop.png`: the imported national-team directory and its filters.
- `mexico-profile-live-desktop.png` and `mexico-profile-live-mobile.png`: the stable-ID profile with five accepted records, coverage metrics and source context.
- `mexico-research-live-desktop.png`: real local evidence and saved research feedback.
- `worldcup-clock-desktop.png` and `worldcup-clock-mobile.png`: original source date/clock, supplied offset and separate next-day UTC instant.

On the actual Pixel 7 viewport the four profile metrics reflow into two columns, source names wrap, recent records precede the sidebar context and the dialog retains readable source/UTC labels. The measured document width equals the 412-pixel CSS viewport width. Profiles require ordinary vertical scrolling to inspect recent records and detailed provenance; no horizontal scrolling is needed for the main workspace.

Build and browser verification are distinct from accessibility certification or production performance measurement. The interface makes no claims of live coverage, complete tournament coverage or official identity.
