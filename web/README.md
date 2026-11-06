# Arena — sports research workspace

A focused product interface for football and VALORANT analytics. Arena connects the match schedule to competition coverage, team form, pre-match evidence and a cited research assistant.

**[Explore the public workspace](https://manuelma4.github.io/lakehouse-copilot/)** · [Architecture and evidence](../README.md) · [Developer reference](../docs/development.md)

## The research workflow

| Workspace                 | What an analyst can inspect                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Match center**          | Date-grouped fixtures and results, event/team/search/date filters, pagination and UTC observation context.                                    |
| **Competitions / Events** | Covered match ranges, participants and observed results tables. Football points and goals remain distinct from VALORANT series wins and maps. |
| **Match research**        | Final or unavailable scores, versioned pre-match form, head-to-head evidence, stored forecasts and a shareable URL.                           |
| **Team explorer**         | Accepted match records, recent form, goals or maps and team statistics.                                                                       |
| **Ask Arena**             | Inspectable citations, structured read-only tool evidence and explicit uncertainty.                                                           |
| **Data & models**         | Quality incidents, lineage and model performance beside a frequency baseline.                                                                 |

The interface takes its information hierarchy from familiar sports research patterns: compact schedules, dated results and competition-to-match navigation. The visual system, fictional monograms, event artwork and implementation are original.

## Evidence is part of the interface

The public showcase contains **600 original fictional matches, 16 teams and six competitions**. Its historical cutoff remains visible. Scheduled rows are relative to that cutoff; they do not imply a current live feed.

Match context reconstructs the highest revision observed before the earlier of kickoff and dataset cutoff. Later corrections and the target result are excluded from pre-match form. Provider-scoped team identities prevent different teams with the same display name from being merged. Competition tables describe accepted observations, **not official standings or a complete season**.

Public hosting uses a validated static snapshot and deterministic evidence answers. It performs no paid API calls or browser-side language-model inference. A local FastAPI workspace additionally supports Ollama explanations, hybrid retrieval and server trace feedback. Both modes display stored model probabilities rather than asking a chatbot to invent them.

## Product engineering

React 19, TypeScript and Vite support a compact responsive interface with self-hosted variable fonts, semantic tables, native research dialogs, labelled filters, keyboard navigation and reduced-motion handling. Query-string navigation preserves deep links and browser history on static hosting.

Browser verification covers real local analytics, public subpath hosting, football and VALORANT semantics, combined filters, historical evidence, source inspection, saved feedback and mobile navigation. Verification records live in the repository; screen-reader certification and field performance are not implied by automated tests.

Original code follows the repository MIT license. Manrope and DM Sans retain OFL-1.1; Lucide icons retain ISC. Their notices are included in `public/licenses/`.
