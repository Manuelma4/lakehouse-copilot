"""SQLite FTS5 BM25 + optional local embeddings, combined using RRF."""

import json
import re
import sqlite3
from pathlib import Path

import httpx
import numpy as np


def embed(texts: list[str], base_url: str, model: str, query=False, timeout=120) -> np.ndarray:
    prefix = "search_query: " if query else "search_document: "
    response = httpx.post(base_url.rstrip("/") + "/api/embed", timeout=max(0.1, timeout),
                         json=dict(model=model, input=[prefix + t for t in texts], truncate=False, keep_alive=0))
    response.raise_for_status()
    vectors = np.asarray(response.json()["embeddings"], dtype=np.float32)
    if vectors.shape != (len(texts), 768) or not np.all(np.isfinite(vectors)):
        raise ValueError("Expected finite 768-dimensional Nomic vectors")
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)


class Retriever:
    def __init__(self, snapshot: Path, state: Path):
        self.snapshot, self.state = Path(snapshot), Path(state)
        self.state.mkdir(parents=True, exist_ok=True)
        self.documents = []
        for path in sorted((self.snapshot / "docs").glob("*.md")):
            body = path.read_text(encoding="utf-8")
            self.documents.append(dict(id=f"docs/{path.name}", title=body.splitlines()[0].lstrip("# "), text=body))
        self.database = self.state / "retrieval.db"
        with sqlite3.connect(self.database) as db:
            db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(id UNINDEXED,title,text)")
            db.execute("DELETE FROM documents")
            db.executemany("INSERT INTO documents VALUES (?,?,?)",
                           [(d["id"], d["title"], d["text"]) for d in self.documents])

    def build_vectors(self, base_url: str, model: str):
        vectors = embed([d["text"] for d in self.documents], base_url, model)
        np.save(self.state / "vectors.npy", vectors, allow_pickle=False)
        (self.state / "vectors.json").write_text(json.dumps(dict(
            ids=[d["id"] for d in self.documents], model=model,
            fingerprint=self.fingerprint())), encoding="utf-8")

    def fingerprint(self):
        import hashlib
        return hashlib.sha256(json.dumps(self.documents, sort_keys=True).encode()).hexdigest()

    def search(self, question: str, limit=3, base_url=None, model=None, timeout=120):
        words = re.findall(r"[A-Za-z0-9]+", question)[:40]
        if not words:
            return []
        expression = " OR ".join('"' + w + '"' for w in words)
        with sqlite3.connect(self.database) as db:
            lexical = db.execute("SELECT id FROM documents WHERE documents MATCH ? ORDER BY bm25(documents) LIMIT 20",
                                 (expression,)).fetchall()
        rankings = [[r[0] for r in lexical]]
        if base_url and model:
            meta_path = self.state / "vectors.json"
            if not meta_path.exists():
                raise ValueError("Build embeddings with arena-copilot index before hybrid retrieval")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta["fingerprint"] != self.fingerprint() or meta["model"] != model:
                raise ValueError("Embedding index belongs to a different corpus or model")
            vectors = np.load(self.state / "vectors.npy", allow_pickle=False)
            query = embed([question], base_url, model, query=True, timeout=timeout)[0]
            rankings.append([meta["ids"][i] for i in np.argsort(-(vectors @ query))[:20]])
        scores = {}
        for ranking in rankings:
            for rank, ident in enumerate(ranking, 1):
                scores[ident] = scores.get(ident, 0) + 1 / (60 + rank)
        order = sorted(scores, key=lambda k: (-scores[k], k))[:limit]
        by_id = {d["id"]: d for d in self.documents}
        return [dict(by_id[k], score=scores[k]) for k in order]
