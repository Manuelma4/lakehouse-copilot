# OpenFootball research interface

Arena's **Open football** view reads a separate `openfootball-research-1.0` package. Its directory, match counts, collection cutoff and footer identify OpenFootball community data. The existing synthetic competition, forecast and cited-chat workflows keep their own dataset identity.

## Product workflow

- **Edition directory:** imported Europe and South America editions, source titles, seasons, accepted record counts and unknown-result counts. Only imported editions appear.
- **Match center:** observed results by default, with all records and unknown results accessible through tabs; combined region, edition, search, source calendar date and result-status filters; 25 records per page. Dates sort descending; local clock labels sort ascending within each date, followed by match ID. An unresolved clock does not establish cross-timezone chronology.
- **Match research:** accepted source score or an unavailable score, kickoff precision, supported `ft`/`ht`/`et`/`p` source fields, collection revisions and provenance. There are no attached forecasts, official tables or reconstructed historical pre-match claims.

Date-only rows display **Time unavailable**. Local-minute rows retain their wall-clock label with **timezone unresolved**. Neither is converted to UTC. UTC timestamps in provenance and the shell describe collection, not kickoff or completion. A missing old result stays **Result unknown**; an accepted explicit 0–0 stays **Observed result**. Source FT is not asserted to mean regulation time.

Edition and match navigation use `view=open-football`, `research_edition` and `research_match` query parameters. These parameters do not open the synthetic match drawer. Native match dialogs support Escape, focus return and copying a shareable URL; unknown IDs produce an explicit unavailable state.

## Transport and rendering

Public builds with `VITE_STATIC_DEMO=true` fetch only `BASE_URL + open-football.json`, with no `/api` or upstream requests. Local mode reads `/api/open-football/snapshot`; if that transport fails, an available published package is labelled as the fallback. If neither package is available, the view shows a retry action and no substituted data.

The loader checks the research version, provider, dataset kind, arrays, precision/result fields and disabled prediction eligibility. Source URLs are clickable only for HTTPS OpenFootball GitHub/raw paths and CC0 license pages; other values remain text. React escapes supplied names. Search tolerates accents without altering displayed names or identities. Generic monograms handle Unicode code points and contain no third-party crests.

The application caches the package after first opening the view. Route code and CSS load separately; the full source archive is not part of the application bundle. A request sequence guard prevents older refresh responses from replacing newer ones. Rendering is limited to 25 match rows and 20 displayed revisions, with any remaining observation count disclosed.

On small screens, search and result tabs remain visible while **Filter source records** expands the region, edition and date controls. The edition selector provides the directory choice on mobile. Primary team names use 14 px text and wrap; the page and native drawer avoid horizontal overflow.

## Verification evidence

Initial browser smokes used the verified nine-source package `5f99ba32f796fb23`: **2,727 matches**, **1,088 observed results** and **1,639 unknown results**. Static and local/API views displayed the same independent source counts. Checks covered an old missing score, a source 0–0, date-only versus unresolved local time, accented names, query deep links, Escape and a 360 px viewport. The static smoke made zero `/api` calls and both modes had zero uncaught browser errors. This is initial smoke evidence; the separate end-to-end suite remains the release gate.

Screenshots and verification reports belong to the release evidence directory. Automated browser checks do not establish screen-reader certification or field performance.
