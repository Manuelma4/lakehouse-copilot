# Sports research workspace

The interface is organised around a research task: find a competition, inspect
a match, compare its teams, and read the evidence behind a forecast. The earlier
landing page put presentation ahead of that task.

The reference review covered [VLR's match calendar](https://www.vlr.gg/matches)
and [event directory](https://www.vlr.gg/events), plus the
[Premier League results view](https://www.premierleague.com/en/results). The useful
patterns are compact dated rows, event context, visible score/status, and a direct
path between competitions, matches and teams. Arena's layout, assets and fixture
data are original.

## Information architecture

- **Match center:** sport, result/upcoming status, competition, dates and team
  search. Rows are grouped by UTC date and open the match research view.
- **Events / Competitions:** observed coverage, match counts, participants,
  results and the competition's calculated team table.
- **Forecasts:** the stored distribution, its feature cutoff, model evidence and
  limitations. Football has three outcomes; VALORANT has two series outcomes.
- **Teams:** completed-match summaries and recent results, with sport-specific
  scoring units.
- **Ask Arena:** citations, read-only tool evidence and explicit model/evidence
  modes.
- **Data & models:** dataset provenance, incidents, feature/model definitions and
  measured evaluation.
- **Open football:** imported CC0 editions, matches and source-derived team
  profiles with separate citations, date precision and collection history.

## Domain rules

Match time, observation time and model cutoff remain separate. A historical
match's pre-match form and head-to-head reconstruct the latest source revision
available before that match; later corrections cannot enter the comparison.
If revision history is unavailable, that limitation must be visible.

Competition dates describe the range of observed fixtures, not an asserted
official start/end calendar. Football points are calculated as three per win and
one per draw over the available results. Tables are labelled as observed coverage,
not official league standings. VALORANT score totals mean maps in a series.
Missing round/player/bracket/prize data is not filled with generated statistics.

The public showcase has six original fictional competitions, three per sport.
It preserves the earlier demo's 600 match IDs, results, 16 teams and eight stored
forecasts while adding useful competition coverage. The original snapshot remains
archived intact. The date badge states the historical evidence cutoff.

The real-source workspace carries its own contract and availability clock. Its
team counts measure imported coverage; source score stages cannot establish
official standings. Numeric offsets permit explicit UTC conversion while
unqualified local clocks remain unresolved. The source agent has its own tools
and trace ledger, and withholds real-team forecasts.

## Finish criteria

The main screen must expose actual matches without a large promotional block.
Desktop density must remain readable, with usable mobile controls and no page
overflow. A selected match, sport and competition should be linkable. Dialogs,
drawers, browser history and keyboard focus must behave consistently.

Verification covers static/live parity, competition filters, score/null semantics,
cutoff reconstruction, observed table arithmetic and the existing cited-chat
flows. Screenshots in the root README show the finished product. Setup commands
belong to the development reference, not the portfolio presentation.
