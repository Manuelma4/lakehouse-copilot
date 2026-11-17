import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone

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


@pytest.mark.parametrize("early", [False, True])
def test_snapshot_generation_cannot_precede_observation_cutoff(tmp_path, early):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "manifest.json"
    manifest = json.loads(path.read_text())
    cutoff = datetime.fromisoformat(manifest["as_of"])
    generated = cutoff.astimezone(timezone(timedelta(hours=-4)))
    if early:
        generated -= timedelta(microseconds=1)
    manifest["generated_at"] = generated.isoformat()
    path.write_text(json.dumps(manifest))

    if early:
        with pytest.raises(SnapshotError, match="generated before its observation cutoff"):
            validate_snapshot(root)
    else:
        assert validate_snapshot(root) == manifest


@pytest.mark.parametrize("case", ["out-of-range", "array", "null"])
def test_prediction_checksum_does_not_replace_semantic_validation(tmp_path, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "predictions.json"
    predictions = json.loads(path.read_text())
    probabilities = predictions[0]["probabilities"]
    if case == "out-of-range":
        probabilities["a"] = 2.0
    elif case == "array":
        predictions[0]["probabilities"] = list(probabilities)
    else:
        predictions[0]["probabilities"] = None
    path.write_text(json.dumps(predictions))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["predictions.json"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(SnapshotError, match="Prediction"):
        validate_snapshot(root)


@pytest.mark.parametrize("case", ["identical", "conflicting", "object", "distinct", "empty"])
def test_prediction_set_matches_snapshot_contract(tmp_path, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "predictions.json"
    predictions = json.loads(path.read_text())
    if case == "object":
        predictions = {}
    elif case == "empty":
        predictions = []
    elif case in ("identical", "conflicting"):
        duplicate = dict(predictions[0])
        if case == "conflicting":
            original_a = duplicate["probabilities"]["a"]
            duplicate["probabilities"] = dict.fromkeys(duplicate["probabilities"], 0)
            duplicate["probabilities"]["a" if original_a != 1 else "b"] = 1
        predictions.append(duplicate)
    else:
        predictions = list(reversed(predictions))
    path.write_text(json.dumps(predictions))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["predictions.json"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    if case in ("distinct", "empty"):
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Duplicate prediction|Predictions must be an array"):
            validate_snapshot(root)


@pytest.mark.parametrize("case", ["swapped teams", "missing team", "different kickoff", "equivalent kickoff"])
def test_forecast_names_and_kickoff_agree_with_canonical_match(tmp_path, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "predictions.json"
    forecasts = json.loads(path.read_text())
    forecast = forecasts[0]
    kickoff = datetime.fromisoformat(forecast["start_time"])
    if case == "swapped teams":
        forecast["team_a"], forecast["team_b"] = forecast["team_b"], forecast["team_a"]
    elif case == "missing team":
        del forecast["team_a"]
    elif case == "different kickoff":
        forecast["start_time"] = (kickoff + timedelta(minutes=5)).isoformat()
    else:
        forecast["start_time"] = kickoff.astimezone(timezone(timedelta(hours=2))).isoformat()
    path.write_text(json.dumps(forecasts))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["predictions.json"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if case == "equivalent kickoff":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Prediction teams or kickoff"):
            validate_snapshot(root)


@pytest.mark.parametrize(("case", "error"), [
    ("identical", "Duplicate canonical match identity"),
    ("conflicting", "Duplicate canonical match identity"),
    ("empty", "Invalid canonical match identity"),
    ("distinct", None),
])
def test_canonical_match_identity_is_nonempty_and_unique(tmp_path, case, error):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    extra = dict(rows[0])
    if case == "conflicting":
        extra["team_b"] = "Another synthetic team"
    elif case == "empty":
        extra["match_id"] = ""
    elif case == "distinct":
        extra["match_id"] = "separate-canonical-match"
        extra.update(status="scheduled", score_a=None, score_b=None, completed_at=None)
    rows.append(extra)
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if error is None:
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match=error):
            validate_snapshot(root)


@pytest.mark.parametrize(("case", "error"), [
    ("duplicate", "Duplicate team statistics identity"),
    ("empty", "Invalid team statistics identity"),
    ("cross-sport", None),
])
def test_team_statistics_use_a_unique_sport_and_team_id(tmp_path, case, error):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    extra = dict(next(row for row in rows if row["draws"] == 0))
    if case == "empty":
        extra["team_id"] = ""
    if case == "cross-sport":
        other = next(row for row in rows if row["sport"] != extra["sport"])
        original_id = other["team_id"]
        other["team_id"] = extra["team_id"]
        matches_path = root / "gold/matches.parquet"
        matches_table = pq.read_table(matches_path)
        matches = matches_table.to_pylist()
        for match in matches:
            if match["sport"] == other["sport"]:
                for field in ("team_a_id", "team_b_id"):
                    if match[field] == original_id:
                        match[field] = other["team_id"]
        pq.write_table(pa.Table.from_pylist(matches, schema=matches_table.schema), matches_path)
    else:
        rows.append(extra)
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    if case == "cross-sport":
        manifest["files"]["gold/matches.parquet"] = hashlib.sha256(matches_path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    if error is None:
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match=error):
            validate_snapshot(root)


@pytest.mark.parametrize(("field", "value"), [
    ("team_name", ""),
    ("matches", 0),
    ("wins", -1),
    ("losses", None),
    ("draws", 1000),
    ("score_for", -1),
    ("score_against", None),
    ("win_rate", "wrong fraction"),
    ("win_rate", float("nan")),
])
def test_team_statistics_reject_inconsistent_aggregates(tmp_path, field, value):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    if value == "wrong fraction":
        value = 0.0 if rows[0]["win_rate"] > 0.5 else 1.0
    rows[0][field] = value
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Invalid team statistics values"):
        validate_snapshot(root)


@pytest.mark.parametrize("sport", ["football", "valorant"])
def test_team_statistics_only_allow_draws_in_football(tmp_path, sport):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    if sport == "football":
        assert any(row["sport"] == "football" and row["draws"] > 0 for row in rows)
    else:
        rows.append(dict(rows[0], sport=sport, team_id="draw-control",
                         matches=1, wins=0, draws=1, losses=0, win_rate=0.0, score_for=0, score_against=0))
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    if sport == "football":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Invalid team statistics values"):
            validate_snapshot(root)


def test_team_statistics_require_both_score_columns(tmp_path):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    pq.write_table(pq.read_table(path).drop_columns(["score_for"]), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Invalid team_stats table schema"):
        validate_snapshot(root)


@pytest.mark.parametrize("change", ["score", "missing team", "extra team"])
def test_team_scores_reconcile_to_completed_matches(tmp_path, change):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    if change == "score":
        rows[0]["score_for"] += 1
    elif change == "missing team":
        rows.pop()
    else:
        rows.append(dict(rows[0], team_id="not-in-completed-matches"))
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Team statistics disagree with canonical match totals"):
        validate_snapshot(root)


@pytest.mark.parametrize("change", ["extra match", "football draw", "valorant win"])
def test_team_outcomes_reconcile_to_completed_matches(tmp_path, change):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/team_stats.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    if change == "extra match":
        team = rows[0]
        team["matches"] += 1
    elif change == "football draw":
        team = next(row for row in rows if row["sport"] == "football" and row["draws"] > 0)
        team["draws"] -= 1
    else:
        team = next(row for row in rows if row["sport"] == "valorant" and row["wins"] > 0)
        team["wins"] -= 1
    team["losses"] += 1
    team["win_rate"] = team["wins"] / team["matches"]
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/team_stats.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Team statistics disagree with canonical match totals"):
        validate_snapshot(root)


@pytest.mark.parametrize("case", ["same id", "missing name", "empty id", "shared display name"])
def test_canonical_match_requires_two_identified_teams(tmp_path, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    match = next(row for row in rows if row["status"] == "finished")
    if case == "same id":
        match["team_b_id"] = match["team_a_id"]
    elif case == "missing name":
        match["team_a"] = None
    elif case == "empty id":
        match["team_b_id"] = ""
    else:
        match["team_b"] = match["team_a"]
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if case == "shared display name":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Invalid canonical match teams"):
            validate_snapshot(root)


@pytest.mark.parametrize(("score", "valid"), [(None, False), (-1, False), (0, True)])
def test_finished_match_scores_are_usable(tmp_path, score, valid):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    match = next(row for row in rows if row["status"] == "finished" and row["sport"] == "football"
                 and (not valid or row["score_a"] == score))
    match["score_a"] = score
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if valid:
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Invalid canonical match score"):
            validate_snapshot(root)


@pytest.mark.parametrize("best_of", [None, 0, 2, 9, 11])
def test_finished_valorant_requires_a_score_consistent_with_best_of(tmp_path, best_of):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    match = next(row for row in rows if row["status"] == "finished"
                 and row["sport"] == "valorant" and row["best_of"] == 3)
    match["best_of"] = best_of
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Invalid completed VALORANT series score"):
        validate_snapshot(root)


@pytest.mark.parametrize("case", ["missing", "at-kickoff", "after-observation", "scheduled", "equivalent-offset"])
def test_canonical_match_completion_has_a_valid_observation_cutoff(tmp_path, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    match = next(row for row in rows if row["status"] == ("scheduled" if case == "scheduled" else "finished"))
    if case == "missing":
        match["completed_at"] = None
    elif case in ("at-kickoff", "scheduled"):
        match["completed_at"] = match["start_time"]
    elif case == "after-observation":
        match["observed_at"] = match["start_time"]
    elif case == "equivalent-offset":
        completion = datetime.fromisoformat(match["completed_at"])
        match["observed_at"] = completion.astimezone(timezone(timedelta(hours=2))).isoformat()
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if case == "equivalent-offset":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Invalid canonical match completion"):
            validate_snapshot(root)


@pytest.mark.parametrize(("status", "case"), [
    ("finished", "future"), ("scheduled", "future"), ("scheduled", "missing"),
    ("scheduled", "naive"), ("scheduled", "same-cutoff"),
])
def test_canonical_observation_respects_snapshot_cutoff(tmp_path, status, case):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    cutoff = datetime.fromisoformat(manifest["as_of"])
    path = root / "gold/matches.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    row = next(item for item in rows if item["status"] == status)
    if case == "future":
        row["observed_at"] = (cutoff + timedelta(seconds=1)).isoformat()
    elif case == "missing":
        row["observed_at"] = None
    elif case == "naive":
        row["observed_at"] = cutoff.replace(tzinfo=None).isoformat()
    else:
        row["observed_at"] = cutoff.astimezone(timezone(timedelta(hours=2))).isoformat()
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    manifest["files"]["gold/matches.parquet"] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    if case == "same-cutoff":
        assert validate_snapshot(root)["schema_version"] == "2.0"
    else:
        with pytest.raises(SnapshotError, match="Invalid canonical match observation|timezone-aware"):
            validate_snapshot(root)


@pytest.mark.parametrize(("field", "value"), [
    ("kickoff", None), ("forecast_cutoff", None), ("forecast_kickoff", 0),
    ("kickoff", "0001-01-01T00:00:00+01:00"),
    ("forecast_cutoff", "9999-12-31T23:59:59-01:00"),
])
def test_unusable_timestamps_raise_snapshot_error(tmp_path, field, value):
    root = tmp_path / "snapshot"
    shutil.copytree(default_fixture(), root)
    if field == "kickoff":
        name = "gold/matches.parquet"
        path = root / name
        table = pq.read_table(path)
        rows = table.to_pylist()
        row = next(item for item in rows if item["status"] == "scheduled")
        row["start_time"] = value
        pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    else:
        name = "predictions.json"
        path = root / name
        rows = json.loads(path.read_text())
        rows[0]["as_of" if field == "forecast_cutoff" else "start_time"] = value
        path.write_text(json.dumps(rows))
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"][name] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(SnapshotError, match="Snapshot timestamps"):
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
