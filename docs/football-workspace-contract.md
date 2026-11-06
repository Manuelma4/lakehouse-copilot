# Football workspace contract

**Status:** next-milestone specification, reviewed 6 October 2026. Arena 0.3 already provides the match/competition research workflow and ID-aware team links. This document defines the additional contract for real OpenFootball imports; it does not claim those imports are deployed or prediction-ready.

## Reference patterns and scope

The [Premier League match page](https://www.premierleague.com/en/matches/premier-league/2026-27) uses a season route and matchweek/date context. [UEFA's fixture page](https://www.uefa.com/uefachampionsleague/fixtures-results/) separates matches, tables and bracket navigation. [FIFA's tournament schedule](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums) provides dated stage and venue context. These are information-architecture references, not data feeds, assets to copy or promises that Arena contains the same metadata.

The directory should group **European domestic**, **National teams** and **Latin America**. Target domestic coverage is England, Spain, Germany, Italy and France. National-team editions and Latin American competitions appear only when a reviewed source file has been imported. Source discovery includes [OpenFootball's league JSON catalogue](https://github.com/openfootball/football.json), [World Cup JSON](https://github.com/openfootball/worldcup.json) and [South America datasets](https://github.com/openfootball/south-america). A country group is not an assertion of complete regional coverage.

## Data admitted to the interface

The [league source example](https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json) contains a title, round, date, optional local time, team names and score representations. Field presence and score semantics must be checked per file. OpenFootball documents that JSON generation and upstream source maintenance have different update cadences; generation time is not proof of recent match coverage. [Source documentation](https://github.com/openfootball/football.json).

| Consumer field                                                         | Display and interpretation                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `competition_id`, `season`, source title                               | Reviewed catalogue identity and edition; preserve the supplied season label, including calendar-year editions. Never merge adjacent seasons by display name.                                                           |
| `team_a_id`, `team_b_id`, `team_namespace`                             | Stable OpenFootball-scoped identities across seasons, explicitly not official federation IDs. Reviewed aliases may change the display name without changing the ID.                                                    |
| `team_type`                                                            | `club`, `national` or `unknown`, supplied by the reviewed registry. Do not infer it from a name, flag or `FC` suffix.                                                                                                  |
| `source_date`, `local_time`, `timezone`, `kickoff_precision`           | Preserve date and optional local clock time. Current staging uses `date_only` or `local_minute`, with unknown timezone and null `start_time`. An exact UTC instant requires independently supported timezone metadata. |
| `result_status`, `score_a`, `score_b`, `score_details_json`            | `observed_result` or `unknown_result`; scores retain source `ft`, with optional `ht`/`et`/`p` detail. Do not assume `ft` means a 90-minute prediction target.                                                          |
| `round`, optional stage/group                                          | Display only supplied or explicitly mapped source metadata. A round label does not establish a bracket or qualification path.                                                                                          |
| `observed_at`, source URL/ref, content SHA256, parser version, license | Actual collection and import provenance. Collection time is not match completion time or the original publication time.                                                                                                |

Venues, crests, squads, players, possession, xG, live clocks and disciplinary points remain unavailable unless a separately reviewed source supplies them. Optional richer World Cup files require their own parser/field contract; their existence does not populate league records.

## Product behavior

**Directory → edition → match → team** remains the primary loop. Competition cards show edition, imported match/date range, source, result coverage and last collection. Edition filters add season and supplied round/group to the existing team/search/date controls. Match rows retain original date semantics: exact instants may have a timezone selector; date-only rows stay on their source calendar date and never display fabricated `00:00 UTC`. Local times without timezone display `20:00 · timezone unknown`; missing times display `Kickoff time unavailable`.

Use **Results**, **Fixtures** and **Result unavailable** categories. A missing past score is not a scheduled fixture, a 0–0 draw or proof of postponement. A valid explicit 0–0 score remains a result. Unknown results keep null scores and stay out of completed-match counts. No running/live/overdue status is inferred from the wall clock or a date-only import.

The edition table remains **Observed results table**, with the imported/result counts beside it. Apply league points only to a reviewed league rule set; cup knockout rows do not create league standings. Where regulation, extra-time or penalties are ambiguous, retain the result and source detail but withhold the affected W/D/L or qualification claim. Gaps display `No imported matches for this filter`, not `No matches took place`. Do not assert full season coverage or official tie-breakers from an observed sample.

Match detail shows source date precision, source round, result availability, import provenance and supported score breakdown. Retrospective form without availability history is labelled **Historical results in the imported snapshot**. It is not evidence of what was known before kickoff. Genuine pre-match reconstruction requires trustworthy observation history and an unambiguous cutoff; otherwise it is unavailable. Staged imports remain `prediction_eligible=false` until completion timing, target score semantics and temporal-leakage checks pass. Existing synthetic forecasts retain their separate dataset/model identity.

## Routing and delivery gates

Arena 0.3 already passes team IDs/keys from match and competition links. Real imports must retain that behavior with URL-encoded scoped IDs, an edition key and query-string routes supported by static hosting. Legacy name links resolve only an unambiguous identity; unknown/ambiguous IDs show an explicit state rather than silently opening the first team. A shared display name, renamed club and same club in two seasons must open the correct persistent profile after reload/back/forward. Profile statistics state their edition/competition scope and use authoritative totals, including teams outside the initial match page.

Keep server pagination before rendering, bounded snapshot imports and at most 25 match rows per page. Filter changes must not let stale requests overwrite newer results. Target interaction feedback within 100 ms after data arrives; measure it rather than claiming it. Keep initial compressed JavaScript within 120 KB or record a justified budget change; large historical archives must not enter the application bundle.

At 360 px, show readable team/date/score labels, 14 px primary row text, usable touch targets and no page-level horizontal overflow. Tables may scroll in a labelled container; preserve the team and score columns. Keyboard filters, dialog Escape/focus return, polite loading/error states and reduced-motion handling remain required.

Release verification must cover date-only and unzoned times, missing historical results, explicit 0–0, score variants, season isolation, duplicate display names, coverage gaps and stale-response handling in both local/API and public snapshot modes. Test provenance links against the imported bytes/ref. Provide desktop/mobile screenshots and measured bundle/import sizes; automated browser checks do not establish screen-reader certification or field Core Web Vitals.
