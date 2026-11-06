"""Black-box WorldCup/source-team oracles from reviewed primary-source examples."""

import hashlib
import json
import shutil

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot
from arena_copilot.api import create_app
from arena_copilot.openfootball import OpenFootballResearch, ResearchError, default_research, validate_research
from arena_copilot.snapshot import default_fixture


PINNED_SHA = "0ae2c18109b5aa86bc11928b43586ca430c234804d5bbf808d2c3bf2051ecfca"
PINNED_REF = "516d3825c3bd23fdc298c4014e84bde78f2d4965"
PERFORMANCE_FIELDS = {"wins", "draws", "losses", "points", "rank", "standings", "win_probability"}


def read(root, name):
    return json.loads((root / f"{name}.json").read_text(encoding="utf-8"))


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def write(root, name, value):
    (root / f"{name}.json").write_bytes(encode(value) + b"\n")


def reseal(root):
    """Act as a package author, so semantic failures cannot hide behind checksums."""
    names = ("matches", "history", "sources", "competitions", "quality", "lineage", "quarantine", "polls")
    payload = {name: read(root, name) for name in names}
    for name, table in (("matches", "matches"), ("history", "match_history")):
        schema = pq.read_schema(root / f"gold/{table}.parquet")
        pq.write_table(pa.Table.from_pylist(payload[name], schema=schema), root / f"gold/{table}.parquet")
    manifest = read(root, "manifest")
    manifest["dataset_version"] = hashlib.sha256(encode(dict(as_of=manifest["as_of"], **payload))).hexdigest()[:16]
    manifest["files"] = {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file() and path.name != "manifest.json"
    }
    write(root, "manifest", manifest)


def change_event(row):
    excluded = {"edition_id", "revision", "event_id", "observed_at", "source_sha256", "source_url", "license", "license_url"}
    business = {key: value for key, value in row.items() if key not in excluded}
    suffix = hashlib.sha256(encode(business)).hexdigest()[:16]
    row["event_id"] = f"{row['match_id']}:{row['revision']}:{suffix}"


@pytest.fixture
def package(tmp_path):
    destination = tmp_path / "owned-research"
    shutil.copytree(default_research(), destination)
    assert read(destination, "manifest")["research_version"] == "openfootball-research-2.0"
    return destination


@pytest.fixture
def source_api(package, tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_OPEN_FOOTBALL", str(package))
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "")
    agent = Copilot(default_fixture(), tmp_path / "owned-agent")
    with TestClient(create_app(agent)) as client:
        yield client


def national(snapshot, name):
    return next(team for team in snapshot["team_profiles"] if team["team_name"] == name and team["team_type"] == "national")


def test_full_pinned_coverage_preserves_national_counts_and_separate_score_phases(package):
    snapshot = OpenFootballResearch(package).snapshot()
    assert len(snapshot["matches"]) == 2831 and len(snapshot["competitions"]) == 10
    world = [row for row in snapshot["matches"] if row["edition_id"] == "worldcup-2026"]
    assert len(world) == 104 and all(row["source_sha256"] == PINNED_SHA for row in world)
    assert len([team for team in snapshot["teams"] if team["team_type"] == "national"]) == 48
    assert sum(row["source_match_number"] is None for row in world) == 72
    assert sum(row["result_status"] == "observed_result" for row in snapshot["matches"]) == 1192
    assert sum(row["result_status"] == "unknown_result" for row in snapshot["matches"]) == 1639
    final = next(row for row in world if row["source_match_number"] == 104)
    assert (final["team_a"], final["team_b"], final["score_a"], final["score_b"]) == ("Spain", "Argentina", 0, 0)
    assert json.loads(final["score_details_json"]) == {"ft": [0, 0], "ht": [0, 0], "et": [1, 0]}
    assert final["start_time"] == "2026-07-19T19:00:00.000000Z"
    penalties = next(row for row in world if row["source_match_number"] == 74)
    assert (penalties["team_a"], penalties["team_b"]) == ("Germany", "Paraguay")
    assert json.loads(penalties["score_details_json"]) == {"ft": [1, 1], "ht": [0, 1], "et": [1, 1], "p": [3, 4]}
    assert all(row["prediction_eligible"] is False and row["completed_at"] is None for row in world)


def test_national_directory_search_paginates_filtered_scope_and_cannot_return_synthetic_teams(source_api):
    first = source_api.get("/open-football/teams", params={"team_type": "national", "limit": 25}).json()
    second = source_api.get("/open-football/teams", params={"team_type": "national", "limit": 25, "offset": 25}).json()
    assert first["contract_version"] == "openfootball-research-2.0" and first["data_kind"] == "open_data"
    assert first["total"] == second["total"] == 48
    assert (len(first["rows"]), len(second["rows"])) == (25, 23)
    all_teams = first["rows"] + second["rows"]
    assert len({row["team_id"] for row in all_teams}) == 48
    assert all(row["team_type"] == "national" and row["region"] == "International" for row in all_teams)
    assert all(row["team_namespace"] == "openfootball-national-men" for row in all_teams)
    mexico = source_api.get("/open-football/teams", params={"search": "mExIcO", "team_type": "national", "limit": 1}).json()
    assert mexico["total"] == 1 and mexico["rows"][0]["team_name"] == "Mexico"
    assert source_api.get("/open-football/teams", params={"search": "' OR 1=1 --"}).json()["total"] == 0
    assert source_api.get("/open-football/teams?team_type=professional").status_code == 422
    assert source_api.get("/open-football/teams?limit=101").status_code == 422
    assert source_api.get("/open-football/teams/unlisted").status_code == 404
    assert source_api.get("/teams?sport=football").json()["data_kind"] == "synthetic"


def test_profiles_measure_imported_records_and_source_date_filters_despite_utc_rollover(source_api):
    snapshot = source_api.get("/open-football/snapshot").json()
    mexico = national(snapshot, "Mexico")
    profile = source_api.get(f"/open-football/teams/{mexico['team_id']}").json()
    assert profile["date_basis"] == "source_calendar_date" and profile["total"] == 5
    assert (profile["team"]["record_count"], profile["team"]["observed_results"], profile["team"]["unknown_results"]) == (5, 5, 0)
    dates = ["2026-07-05", "2026-06-30", "2026-06-24", "2026-06-18", "2026-06-11"]
    rows = {row["match_id"]: row for row in snapshot["matches"]}
    recent = [rows[ident] for ident in profile["team"]["recent_match_ids"]]
    assert [row["source_date"] for row in recent] == dates
    assert [row["source_match_number"] for row in recent] == [92, 79, None, None, None]
    assert profile["team"]["edition_ids"] == ["worldcup-2026"]
    assert not PERFORMANCE_FIELDS & profile["team"].keys()
    assert all(not PERFORMANCE_FIELDS & edition.keys() for edition in profile["team"]["editions"])
    assert national(snapshot, "Spain")["record_count"] == 8
    assert national(snapshot, "Germany")["record_count"] == 4
    korea = national(snapshot, "South Korea")
    assert korea["record_count"] == 3
    june11 = source_api.get(f"/open-football/teams/{korea['team_id']}", params={"date_from": "2026-06-11", "date_to": "2026-06-11"}).json()
    assert june11["total"] == 1 and june11["rows"][0]["start_time"] == "2026-06-12T02:00:00.000000Z"
    june12 = source_api.get(f"/open-football/teams/{korea['team_id']}", params={"date_from": "2026-06-12", "date_to": "2026-06-12"}).json()
    assert june12["total"] == 0 and june12["team"]["record_count"] == 3
    assert source_api.get(f"/open-football/teams/{korea['team_id']}", params={"date_from": "2026-07-01", "date_to": "2026-06-01"}).status_code == 400
    club = next(team for team in snapshot["team_profiles"] if team["team_type"] == "club" and team["record_count"] > 25)
    assert club["recent_match_limit"] == len(club["recent_match_ids"]) == 25
    assert len(set(club["recent_match_ids"])) == 25 and club["record_count"] > len(club["recent_match_ids"])
    assert all(club["team_id"] in (rows[ident]["team_a_id"], rows[ident]["team_b_id"]) for ident in club["recent_match_ids"])


@pytest.mark.parametrize("mutation", [
    "rollover_day", "offset", "club_type", "archive",
    "consistent_ft", "source_group", "ground", "opponent",
])
def test_resealed_v2_source_claims_fail_closed_beyond_inventory_checksums(package, mutation):
    for name in ("matches", "history"):
        rows = read(package, name)
        if mutation == "opponent":
            row = next(row for row in rows if row["edition_id"] == "worldcup-2026" and row["source_match_number"] == 74)
        else:
            row = next(row for row in rows if row["edition_id"] == "worldcup-2026" and row["team_a"] == "South Korea")
        if mutation == "rollover_day":
            row["start_time"] = "2026-06-11T02:00:00.000000Z"
        elif mutation == "offset":
            row["utc_offset_minutes"] = -300
        elif mutation == "club_type":
            row["team_type"] = "club"
        elif mutation == "archive":
            row["source_sha256"] = "f" * 64
        elif mutation == "consistent_ft":
            row["score_a"] = 3
            details = json.loads(row["score_details_json"])
            details["ft"] = [3, 1]
            row["score_details_json"] = encode(details).decode("utf-8")
        elif mutation == "source_group":
            row["source_group"] = "Group B"
        elif mutation == "ground":
            row["ground"] = "Mexico City"
        else:
            czech = next(candidate for candidate in rows if candidate["edition_id"] == "worldcup-2026"
                         and candidate["team_b"] == "Czech Republic")
            row["team_b"] = czech["team_b"]
            row["team_b_id"] = czech["team_b_id"]
        change_event(row)
        write(package, name, rows)
    reseal(package)
    with pytest.raises(ResearchError):
        validate_research(package)


def test_source_aware_evidence_trace_and_feedback_remain_separate_from_synthetic_chat(source_api):
    snapshot = source_api.get("/open-football/snapshot").json()
    final = next(row for row in snapshot["matches"] if row["edition_id"] == "worldcup-2026"
                 and row["source_match_number"] == 104)
    response = source_api.post("/open-football/chat", json={"question": "Show this match's source evidence.",
        "match_id": final["match_id"], "mode": "evidence"})
    assert response.status_code == 200
    answer = response.json()
    assert (answer["provider"], answer["data_kind"], answer["mode"]) == ("openfootball", "open_data", "evidence")
    assert answer["dataset_version"] == snapshot["manifest"]["dataset_version"]
    assert answer["snapshot_fingerprint"] == snapshot["snapshot_fingerprint"]
    assert answer["model"] is None and answer["metrics"]["generated_tokens"] == 0
    tool = next(tool for tool in answer["tool_results"] if tool["tool"] == "research_match")
    assert tool["rows"][0]["match_id"] == final["match_id"]
    assert tool["rows"][0]["source_score_stages"] == {"ft": [0, 0], "ht": [0, 0], "et": [1, 0]}
    assert answer["citations"] and all(cite["uri"].startswith(f"snapshot://{answer['dataset_version']}/")
                                     for cite in answer["citations"])
    feedback = {"trace_id": answer["trace_id"], "rating": 1, "comment": "Independent fixture evidence review"}
    assert source_api.post("/open-football/feedback", json=feedback).json()["status"] == "saved"
    assert source_api.post("/feedback", json=feedback).status_code == 400
    mexico = national(snapshot, "Mexico")
    team = source_api.post("/open-football/chat", json={"question": "Show imported coverage for this team.",
        "team_id": mexico["team_id"], "mode": "evidence"}).json()
    profile = next(tool for tool in team["tool_results"] if tool["tool"] == "research_team")["rows"][0]
    assert profile["team_id"] == mexico["team_id"] and profile["record_count"] == 5
    assert team["trace_id"] != answer["trace_id"] and not PERFORMANCE_FIELDS & profile.keys()


def test_research_context_validation_and_predictions_fail_without_substituting_synthetic_data(source_api):
    snapshot = source_api.get("/open-football/snapshot").json()
    mexico = national(snapshot, "Mexico")
    common = {"question": "Show imported coverage.", "mode": "evidence"}
    assert source_api.post("/open-football/chat", json={**common, "team_id": mexico["team_id"],
                                                      "edition_id": "worldcup-2026"}).status_code == 422
    assert source_api.post("/open-football/chat", json={**common, "team_id": "synthetic-team"}).status_code == 422
    unknown = source_api.post("/open-football/chat", json={**common,
        "team_id": "openfootball:team:" + "f" * 24}).json()
    assert unknown["abstained"] is True and unknown["tool_results"] == []
    assert unknown["data_kind"] == "open_data" and unknown["dataset_version"] == snapshot["manifest"]["dataset_version"]
    assert "not present" in unknown["answer"]
    forecast = source_api.post("/open-football/chat", json={"question": "Predict Mexico's next winning probability.",
        "mode": "evidence", "team_id": mexico["team_id"]}).json()
    assert forecast["abstained"] is True and forecast["model"] is None
    assert forecast["metrics"]["generated_tokens"] == 0
    assert {tool["tool"] for tool in forecast["tool_results"]} == {"research_quality"}
    assert not any("predictions" in cite["id"] for cite in forecast["citations"])
    assert source_api.post("/open-football/feedback", json={"trace_id": "f" * 32, "rating": 1}).status_code == 404


def test_fixture_model_cannot_cite_synthetic_forecasts_as_selected_real_match_evidence(source_api, monkeypatch):
    snapshot = source_api.get("/open-football/snapshot").json()
    final = next(row for row in snapshot["matches"] if row["edition_id"] == "worldcup-2026"
                 and row["source_match_number"] == 104)
    calls = []

    def ungrounded(messages, **kwargs):
        calls.append(messages)
        return {"message": {"content": json.dumps({"answer": "Spain won the stored matchup.",
            "citation_ids": ["predictions.json"], "abstained": False})}, "eval_count": 0}

    monkeypatch.setattr(source_api.app.state.copilot, "_chat", ungrounded)
    response = source_api.post("/open-football/chat", json={"question": "Explain this match source result.",
        "match_id": final["match_id"], "mode": "ollama"})
    assert response.status_code == 200
    answer = response.json()
    assert len(calls) == 1 and final["match_id"] in json.dumps(calls)
    assert answer["abstained"] is True and answer["citations"] == []
    assert "validated research references" in answer["answer"]
    assert answer["data_kind"] == "open_data" and answer["dataset_version"] == snapshot["manifest"]["dataset_version"]
    assert answer["tool_results"][0]["rows"][0]["match_id"] == final["match_id"]
