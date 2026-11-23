# Evaluation protocol

`cases.py` contains 120 original proposed cases: 60 documentation questions, 20
tool/KPI questions, 20 unavailable questions, ten ambiguous questions and ten
adversarial requests. Labels and the 75/25 development/holdout split are recorded
before retrieval comparisons. These are AI-authored proposed labels; **human
semantic review is pending**. The fixture's match IDs are intentionally fixed.

From the repository root with the project Python environment active, run the
lexical baseline against the bundled synthetic showcase. It uses the local
SQLite index and needs no embedding server.

```bash
python scripts/evaluate_retrieval.py --output data/evaluation/lexical.json
```

With the configured [local embedding model](../docs/development.md#generation-and-retrieval)
running, collect the lexical, dense and RRF scores together.

```bash
python scripts/evaluate_retrieval.py --hybrid --output data/evaluation/hybrid.json
```

Both commands score the 60 document questions by development and holdout split.
The hybrid run builds document vectors and embeds all document questions in one
batch. It calls the embedding endpoint without requesting generated answers.
Both commands use `data/copilot` for retrieval state. Use a separate checkout
for the evaluation if another process is using that state. The explicit output
paths keep new reports under ignored `data/`. Omitting `--output` writes to the
versioned evidence path `docs/evidence/retrieval-evaluation.json`.

Compare Recall@5 for each ranking and split on the same snapshot and corpus.
The eight-document corpus is small and the labels still need human review.
The scores measure source retrieval only.

Before a full agent evaluation, review the source labels, scope of unanswerable
questions and expected clarification behavior; freeze the holdout split. Evaluate
actual inference separately with model digest, prompt version, corpus fingerprint,
probability tolerance, abstention, tools, errors and latency. Inspect citation
support manually. Never combine evidence-browser results with generative answers
to produce an inflated model accuracy score.
