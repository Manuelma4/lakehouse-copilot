"""Measure labelled document retrieval separately from generative answer quality."""

import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from arena_copilot.agent import Copilot
from arena_copilot.retrieval import embed
from arena_copilot.snapshot import default_fixture

parser = argparse.ArgumentParser()
parser.add_argument("--hybrid", action="store_true")
parser.add_argument("--output", type=Path, default=Path("docs/evidence/retrieval-evaluation.json"))
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("arena_cases", Path("evaluation/cases.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
all_cases = module.cases()
documents = [case for case in all_cases if case["category"] == "document"]
agent = Copilot(default_fixture(), Path("data/copilot"))
retriever = agent.retriever
ids = [doc["id"] for doc in retriever.documents]
vectors, queries = None, None
if args.hybrid:
    retriever.build_vectors(agent.base_url, agent.embed_model)
    vectors = np.load(retriever.state / "vectors.npy", allow_pickle=False)
    queries = embed([case["question"] for case in documents], agent.base_url, agent.embed_model, query=True)
records = []
for index, case in enumerate(documents):
    lexical = [doc["id"] for doc in retriever.search(case["question"], limit=8)]
    rankings = {"lexical": lexical}
    if args.hybrid:
        dense = [ids[i] for i in np.argsort(-(vectors @ queries[index]))]
        scores = {}
        for ranking in (lexical, dense):
            for rank, identifier in enumerate(ranking, 1):
                scores[identifier] = scores.get(identifier, 0) + 1 / (60 + rank)
        rankings.update(dense=dense, hybrid=sorted(scores, key=lambda key: (-scores[key], key)))
    records.append(dict(id=case["id"], split=case["split"], expected_sources=case["expected_sources"],
                        top5={name: values[:5] for name, values in rankings.items()},
                        recall_at_5={name: len(set(values[:5]) & set(case["expected_sources"])) / len(case["expected_sources"])
                                     for name, values in rankings.items()}))
metrics = {}
for split in ("development", "holdout"):
    subset = [r for r in records if r["split"] == split]
    metrics[split] = {name: float(np.mean([r["recall_at_5"][name] for r in subset])) for name in records[0]["recall_at_5"]}
report = dict(status="measured_locally", recorded_at=datetime.now(timezone.utc).isoformat(),
    scope="Document retrieval only: eight source documents, 60 original labelled questions, no generative inference",
    dataset_version=agent.manifest["dataset_version"], snapshot_fingerprint=agent.snapshot_fingerprint,
    corpus_fingerprint=retriever.fingerprint(), embedding_model=agent.embed_model if args.hybrid else None,
    categories={category: sum(c["category"] == category for c in all_cases)
                for category in ("document", "tool", "unanswerable", "ambiguous", "adversarial")},
    human_semantic_review="pending; automated retrieval scores are not human answer-quality ratings",
    metrics=metrics, cases=records)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8", newline="\n")
agent.close()
print(json.dumps(dict(metrics=metrics, categories=report["categories"])))
