# Evaluation protocol

`cases.py` contains 120 original proposed cases: 60 documentation questions, 20
tool/KPI questions, 20 unavailable questions, ten ambiguous questions and ten
adversarial requests. Labels and the 75/25 development/holdout split are recorded
before retrieval comparisons. These are AI-authored proposed labels; **human
semantic review is pending**. The fixture's match IDs are intentionally fixed.

Run document retrieval evaluation with actual Nomic embeddings:

```powershell
python scripts/evaluate_retrieval.py --hybrid
```

The report measures lexical, dense and RRF Recall@5 separately. Eight documents
make this a small instructional corpus; high Recall@5 cannot establish useful
performance on a larger corpus or answer correctness. Dense queries are embedded
in one batch to avoid repeatedly loading the local model. No LLM judge or paid API
is called.

Before a full agent evaluation, review the source labels, scope of unanswerable
questions and expected clarification behavior; freeze the holdout split. Evaluate
actual inference separately with model digest, prompt version, corpus fingerprint,
probability tolerance, abstention, tools, errors and latency. Inspect citation
support manually. Never combine evidence-browser results with generative answers
to produce an inflated model accuracy score.
