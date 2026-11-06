# OpenFootball research contract

The application consumes `openfootball-research-1.0` and `openfootball-research-2.0`, independent immutable
export from Arena Lakehouse. It complements the UTC-instant-based canonical
snapshot 2.0; it does not silently migrate or reinterpret that contract.

The producer archives fixed no-token OpenFootball source files, validates their
schema, tracks current accepted rows and append-only business revisions in
SQLite, and publishes typed Gold Parquet with a source-edition directory,
quality counts, poll evidence and lineage. Publication is atomic. Missing or
quarantined source records do not automatically delete an earlier observation.

The consumer independently checks every file checksum, exact file scope,
dataset content identity, JSON/Parquet parity, reviewed source catalogue,
name-derived team/match IDs, event identities, contiguous revision history,
latest-current parity, measured summaries and matching source-poll availability.
Symlinks, unsafe paths, duplicate JSON keys, unsupported UTC kickoff clocks and
forecast eligibility are rejected before data reaches a query or the UI.

Running queries use a typed Arrow table constructed from the verified payload.
Later filesystem changes cannot introduce rows bearing an earlier dataset
identity; a new reader still rejects the changed package. This keeps list and
detail/snapshot responses consistent for the lifetime of a reader.

The local research limits are 25,000 current matches, 50,000 revisions and 128 MB
of package files. SQL queries use fixed templates and bound parameters. Source
calendar date filters apply before ordering and pagination; they are inclusive
calendar dates, not UTC-day filters. API pages contain at most 100 rows.

## Precision and result semantics

`source_date` is an original calendar date. `local_time` is an optional original
wall clock. Version 1 precision is `date_only` or `local_minute`, with null UTC
kickoff. Version 2 additionally supports `offset_minute`: an explicit numeric
offset is independently checked against the original date and wall clock to
derive `start_time`. `timezone` remains null because an offset is not an IANA
timezone; `completed_at` remains null. An actual `observed_at` is UTC,
and must match poll evidence. It is never backdated to the historical match.

`observed_result` means the source contains an `ft` score pair. A missing pair
means `unknown_result`, including old fixtures. Stored `ft`, `ht`, `et` and `p`
pairs retain their source labels; they are not inferred regulation-time outcomes.
`prediction_eligible` stays false. The UI withholds forecasts and official tables.

Team IDs derive from a configured country/tournament namespace and normalized
reviewed name. They remain explicitly nonofficial. Seasons share namespace IDs;
cross-country and Libertadores reconciliation is not implied. Match IDs include
competition, season, round, ordered teams and reviewed occurrence, excluding
date/score so accepted corrections retain identity. Numbered national matches in
v2 instead use competition, season and source match number; opponent changes do
not change those identities. Optional group, ground and match number retain
their source values. Version 1 schemas, fingerprints and identities are preserved.

## API and public build

`/open-football/health`, `/open-football/snapshot`, `/open-football/competitions`,
`/open-football/competitions/{edition_id}`, `/open-football/matches` and
`/open-football/matches/{match_id}` are available with and without the `/api`
prefix, together with `/open-football/teams` and `/open-football/teams/{team_id}`.
Profiles are derived only from verified current rows; counts describe imported
coverage rather than official performance. Envelopes expose the dataset version, fingerprint, source precision and
coverage. Detail returns the exact source revision history. Missing datasets
return an explicit service-unavailable response; unknown IDs return 404.

The CC0 build has a dedicated static JSON payload, loaded only when the Open
football view is opened. Public builds do not probe a backend. Local
`/open-football/chat` accepts at most one match, team or edition context and uses
separate read-only tools and a dataset-scoped trace ledger. Its
`/open-football/feedback` cannot write canonical synthetic traces. Public source
questions use labelled deterministic summaries. Canonical chat, model reports
and the synthetic exporter continue to use their original dataset.

The package is an integrity-checked local artefact, not a cryptographic claim of
official authenticity. Source body checksums identify the separate producer
archive; public consumers do not independently redownload raw files on startup.
For the reviewed World Cup edition, both producer and consumer also bind all 104
current match identities and source facts to a byte-preserved, SHA-checked CC0
raw reference. Coherently rehashing a changed score, clock, group, ground or
opponent cannot pass that gate. Other editions have integrity and self-consistency
validation; the World Cup gate does not imply their raw-body authentication.
