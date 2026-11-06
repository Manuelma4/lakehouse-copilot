# Arena Copilot case study

Arena Copilot brings football and VALORANT fixtures, results, team form, and
forecasts into one research workspace. An analyst can open a match from a
competition and trace an answer back to the records used to produce it. The
workspace combines a React and TypeScript interface, a FastAPI backend, and a
local assistant.

## Design decisions

- **An explicit producer-consumer contract.** Arena Lakehouse produces immutable
  exports. Arena Copilot validates the manifest, checksums, and schemas before
  the interface or assistant reads the data. That lets the producer and consumer
  evolve separately while keeping the inputs to an answer reproducible.
  [Snapshot contract](../CONTRACT.md)
- **An assistant that explains stored forecasts.** The assistant uses read-only
  tools and cites the records it queries. The lakehouse model computes the
  forecasts. The assistant explains them and checks quoted percentages against
  the stored probabilities. [Assistant implementation](../src/arena_copilot/agent.py)
- **Coverage and uncertainty stay visible.** The synthetic showcase exercises
  the full workflow. A separate OpenFootball export covers 2,831 matches across
  ten competition editions and preserves unknown results and the original time
  precision. Synthetic forecasts provide no evidence of predictive performance
  on real teams. [Data sources and licenses](../DATA_SOURCES.md)

## Reproduce the checks

The bundled datasets run locally with Python 3.11 and Node.js 24. The demo needs
no provider account or downloaded model. After installing the project using the
[local setup guide](../README.md#run-locally), run these commands from the repository root.

```bash
.venv/bin/arena-copilot validate
.venv/bin/python -m pytest -q
cd web
npm run check
```

The verification record separates fixture tests, browser checks, and runs with a
local model. The answer evaluation corpus still awaits human review.
[Verification record](evidence/README.md)
