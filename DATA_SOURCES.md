# Data sources and attribution

The original synthetic showcase is covered by the repository's MIT license.
The independent `src/arena_copilot/research_fixture` contains a checked research
export of [OpenFootball football.json](https://github.com/openfootball/football.json)
and [worldcup.json](https://github.com/openfootball/worldcup.json).
Their data and schema are dedicated under CC0-1.0; each source row links to its
repository's license, and v2 rows retain the pinned license reference.
Its manifest lists exact package checksums. Every match retains its raw source
URL, source reference, body checksum and actual collection instant.

The recorded import on 6 October 2026 includes England, Spain, Germany, Italy
and France 2026/27; Brazil 2026; and the available Colombia, Argentina and
Libertadores 2025 files, plus the 2026 World Cup. It contains 2,831 rows, of which
1,192 have source results and 1,639 remain unknown. Colombia and Argentina cover the available partial
2025 schedules rather than current complete LATAM seasons.

The World Cup JSON is pinned to commit
`516d3825c3bd23fdc298c4014e84bde78f2d4965` and body SHA-256
`0ae2c18109b5aa86bc11928b43586ca430c234804d5bbf808d2c3bf2051ecfca`.
Its byte-preserved CC0 body is also bundled under `resources/worldcup_2026.json`
to reject coherently resealed changes to the reviewed match facts. This binds
one community source edition; it is not official FIFA verification. A later TXT
source revision has clock differences and is not silently merged into this JSON.
The raw source includes public player references; the normalized package and
agent do not build player features or rosters from them.

These are community records, not an official or real-time feed. The upstream
project distinguishes generated JSON updates from manually maintained scores.
No upstream player photos, club crests, VLR data or commercial telemetry are
bundled. Name-derived IDs do not certify identity across tournaments/providers.

Licensed API adapters remain separate. The synthetic public exporter continues
to reject authenticated football-data.org and PandaScore packages; the CC0
research exporter validates its own source allowlist and contract.

The local Current matches workspace reads validated exports produced by an
authenticated football-data.org and PandaScore collector. Keep its raw
responses, credentials, archives and canonical datasets in a private workspace
outside this repository. The recorded six-competition football collection
contains 2,132 matches. The recorded VALORANT canonical collection contains 106
matches.

The optional display exporter renders a bounded processed window. It keeps
source credits and freshness with the display. Use it only where the
provider's terms permit. Provider information remains subject to those terms. Keep
generated display files and screenshots with provider records out of the
repository, release assets, and test fixtures. Use the bundled fictional
showcase or CC0 fixture for public screenshots and reproductions.

Football data provided by the Football-Data.org API.
Source: PandaScore.
Provider display remains subject to their
[football-data.org terms](https://www.football-data.org/client/register) and
[PandaScore terms](https://www.pandascore.co/terms-and-condition).
No provider logos, player photos, in-game telemetry or odds are supplied.
