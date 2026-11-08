import hashlib
import json
import shutil

import pytest
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot, ModelUnavailable
from arena_copilot.api import create_app
from arena_copilot.snapshot import SnapshotError, default_fixture, validate_snapshot
from arena_copilot.tools import Tools


def test_fixture_is_independent_and_consistent():
    manifest = validate_snapshot(default_fixture())
    assert manifest["schema_version"] == "2.0"
    assert manifest["data_kind"] == "synthetic"


@pytest.mark.parametrize("change", ["tamper", "extra", "missing", "version", "path"])
def test_rejects_invalid_snapshot_before_use(tmp_path, change):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if change == "tamper":
        (root / "quality.json").write_text("{}")
    elif change == "extra":
        (root / "surprise.txt").write_text("extra")
    elif change == "missing":
        (root / "metrics.json").unlink()
    elif change == "version":
        manifest["schema_version"] = "99.0"
    else:
        manifest["files"]["../escape"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(SnapshotError):
        validate_snapshot(root)


def test_prediction_checksum_does_not_replace_semantic_validation(tmp_path):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "predictions.json"
    predictions = json.loads(path.read_text())
    predictions[0]["probabilities"]["a"] = 2.0
    path.write_text(json.dumps(predictions))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["predictions.json"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(SnapshotError, match="Prediction"):
        validate_snapshot(root)


@pytest.mark.parametrize("duplicate", ["identical", "conflicting", "distinct"])
def test_canonical_match_identity_is_unique_even_with_valid_checksums(tmp_path, duplicate):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    extra = dict(rows[0])
    if duplicate == "conflicting":
        extra["team_b"] = "Another synthetic team"
    elif duplicate == "distinct":
        extra["match_id"] = "separate-canonical-match"
    rows.append(extra)
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if duplicate == "distinct":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Duplicate canonical match identity"):
            validate_snapshot(root)


def test_tool_sql_injection_and_write_requests_are_rejected():
    tools = Tools(default_fixture())
    assert tools.call("get_team_stats", {"team_name": "' OR 1=1 --"})["rows"] == []
    with pytest.raises(ValueError):
        tools.call("run_sql", {"sql": "DROP TABLE matches"})
    with pytest.raises(ValueError):
        tools.call("get_team_stats", {"sql": "SELECT *"})


def test_team_measures_are_separated_by_sport():
    tools = Tools(default_fixture())
    rows = tools.call("get_team_stats", {"sport": "valorant"})["rows"]
    assert rows and all(r["sport"] == "valorant" and r["draws"] == 0 for r in rows)
    assert all(r["wins"] + r["draws"] + r["losses"] == r["matches"] for r in rows)


def test_api_evidence_trace_feedback_and_error_status(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    with TestClient(create_app(agent)) as client:
        assert client.get("/health").json()["snapshot_verified"]
        response = client.post("/chat", json={"question": "VALORANT team win rates", "mode": "evidence"})
        assert response.status_code == 200
        answer = response.json()
        assert answer["mode"] == "evidence" and answer["model"] is None
        assert answer["citations"] and answer["metrics"]["tool_calls"] <= 6
        assert client.post("/feedback", json={"trace_id": answer["trace_id"], "rating": 1}).status_code == 200
        assert client.post("/feedback", json={"trace_id": "0" * 32, "rating": 1}).status_code == 400
        def unavailable(*args, **kwargs):
            raise ModelUnavailable("Ollama unavailable")
        monkeypatch.setattr(agent, "_chat", unavailable)
        assert client.post("/chat", json={"question": "Show team stats"}).status_code == 503


def test_six_tool_limit_is_enforced(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def malicious(*args, **kwargs):
        return {"message": {"role": "assistant", "tool_calls": [
            {"function": {"name": "get_catalog", "arguments": {}}} for _ in range(7)]}}
    monkeypatch.setattr(agent, "_chat", malicious)
    response = agent.ask("Inspect data", "ollama")
    assert response["abstained"]
    assert response["metrics"]["tool_calls"] == 0


def test_invalid_citation_is_not_returned(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def model(*args, **kwargs):
        if kwargs.get("output_schema"):
            return {"message": {"content": json.dumps(dict(answer="Made-up result", citation_ids=["private.csv"], abstained=False))}}
        return {"message": {"role": "assistant", "content": "draft"}}
    monkeypatch.setattr(agent, "_chat", model)
    response = agent.ask("Explain predictions")
    assert response["abstained"] and not response["citations"]


def test_explicit_match_prediction_is_read_before_one_generation(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    prediction = agent.tools.read_json("predictions.json")[-1]
    calls = []
    def model(messages, **kwargs):
        calls.append(kwargs)
        assert kwargs.get("output_schema") and not kwargs.get("tools")
        assert prediction["match_id"] in messages[0]["content"]
        assert str(prediction["probabilities"]["a"]) in messages[0]["content"]
        return {"message": {"content": json.dumps(dict(answer="Stored synthetic model probabilities.",
                citation_ids=["predictions.json"], abstained=False))}}
    monkeypatch.setattr(agent, "_chat", model)
    response = agent.ask(f"What is the prediction for {prediction['match_id']}?")
    assert len(calls) == response["metrics"]["tool_calls"] == 1
    assert response["tool_results"][0]["rows"] == [prediction]
    assert not response["abstained"]


def test_unknown_prediction_abstains_without_inference(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    def must_not_run(*args, **kwargs):
        raise AssertionError("Unknown stored forecast must not trigger speculative inference")
    monkeypatch.setattr(agent, "_chat", must_not_run)
    response = agent.ask("Predict synthetic:valorant:999999")
    assert response["abstained"] and response["metrics"]["generated_tokens"] == 0
    assert response["tool_results"][0]["rows"] == []
