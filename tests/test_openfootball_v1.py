"""Golden legacy serialization read by the v2-capable consumer without migration."""

import hashlib
from pathlib import Path

import pyarrow.parquet as pq

from arena_copilot.openfootball import GOLD_SCHEMA, OpenFootballResearch


def test_genuine_legacy_subset_keeps_original_ids_null_clocks_and_typed_queries():
    root = Path(__file__).parent / "fixtures/research_v1"
    before = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in root.rglob("*") if p.is_file()}
    research = OpenFootballResearch(root)
    assert research.manifest["research_version"] == "openfootball-research-1.0"
    assert research.manifest["dataset_version"] == "f07a33073ce37319"
    assert research.fingerprint == "d082b4844033ae7545bc505835afeb384341a1cb12f9355babd30b4c74f92af5"
    assert pq.read_schema(root / "gold/matches.parquet") == GOLD_SCHEMA
    observed_id = "openfootball:match:01df86ed63906e845a6bdc8a"
    unknown_id = "openfootball:match:03392e67e692177a012d3a9d"
    observed = research.match(observed_id)["match"]
    assert observed["event_id"] == observed_id + ":1:7ed04623fcdb2613"
    assert (observed["team_a"], observed["team_b"], observed["score_a"], observed["score_b"]) == (
        "Deportivo Cali", "Millonarios", 3, 1)
    assert observed["local_time"] == "18:10" and observed["kickoff_precision"] == "local_minute"
    assert "utc_offset_minutes" not in observed and "team_type" not in observed
    unknown = research.matches(result_status="unknown_result")["rows"]
    assert len(unknown) == 1 and unknown[0]["match_id"] == unknown_id
    assert unknown[0]["score_a"] is None and unknown[0]["score_b"] is None
    assert all(row["start_time"] is None and row["completed_at"] is None and row["timezone"] is None
               and not row["prediction_eligible"] for row in research.payload["matches"])
    teams = research.teams()["rows"]
    assert len(teams) == 4 and all(team["team_type"] == "club" for team in teams)
    profile = research.team(observed["team_a_id"])
    assert profile["team"]["record_count"] == 1 and profile["rows"][0]["match_id"] == observed_id
    after = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in root.rglob("*") if p.is_file()}
    assert before == after
