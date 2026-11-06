"""Offline consumer contract tests using a small subset of the checked CC0 package."""

import hashlib
import json
import shutil
from datetime import datetime, timedelta

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot
from arena_copilot.api import create_app
from arena_copilot.openfootball import OpenFootballResearch, ResearchError, default_research, validate_research
from arena_copilot.snapshot import default_fixture


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def write_json(root, name, value):
    (root / f"{name}.json").write_bytes(encode(value) + b"\n")


def seal(root, *, update_gold=False):
    manifest = json.loads((root / "manifest.json").read_text())
    payload = {name: json.loads((root / f"{name}.json").read_text(encoding="utf-8")) for name in
               ("matches", "history", "sources", "competitions", "quality", "lineage", "quarantine", "polls")}
    if update_gold:
        for name, table in (("matches", "matches"), ("history", "match_history")):
            schema = pq.read_schema(root / f"gold/{table}.parquet")
            pq.write_table(pa.Table.from_pylist(payload[name], schema=schema), root / f"gold/{table}.parquet")
    manifest.update(matches=len(payload["matches"]), revisions=len(payload["history"]),
                    sources=len(payload["sources"]), quarantine_rows=len(payload["quarantine"]))
    manifest["dataset_version"] = sha(encode(dict(as_of=manifest["as_of"], **payload)))[:16]
    manifest["files"] = {p.relative_to(root).as_posix(): sha(p.read_bytes()) for p in sorted(root.rglob("*"))
                         if p.is_file() and p.name != "manifest.json"}
    write_json(root, "manifest", manifest)


@pytest.fixture
def package(tmp_path):
    root = tmp_path / "package"
    shutil.copytree(default_research(), root)
    original = validate_research(root)
    edition = next(e for e in original["competitions"] if e["edition_id"] == "colombia-primera-a-2025")
    subset = [r for r in original["matches"] if r["edition_id"] == edition["edition_id"]]
    observed = next(r for r in subset if r["result_status"] == "observed_result")
    unknown = next(r for r in subset if r["kickoff_precision"] == "date_only" and r["result_status"] == "unknown_result")
    rows = sorted([observed, unknown], key=lambda r: r["match_id"])
    teams = {r[f"team_{s}_id"]: r[f"team_{s}"] for r in rows for s in ("a", "b")}
    edition = dict(edition, match_count=2, observed_results=1, unknown_results=1,
        date_only=sum(r["local_time"] is None for r in rows), local_minute=sum(r["local_time"] is not None for r in rows),
        coverage_start=min(r["source_date"] for r in rows), coverage_end=max(r["source_date"] for r in rows),
        participants=[dict(team_id=k, team_name=teams[k]) for k in sorted(teams)])
    source = next(s for s in original["sources"] if s["source_id"] == edition["edition_id"])
    poll = next(p for p in original["polls"] if p["source_id"] == edition["edition_id"])
    poll = dict(poll, changed=2)
    quality = dict(original["quality"], match_count=2, revision_count=2, source_count=1, observed_results=1,
        unknown_results=1, date_only=edition["date_only"], local_minute=edition["local_minute"],
        unresolved_timezones=2, unresolved_team_identities=len(teams), prediction_ineligible=2)
    if original["manifest"]["research_version"] == "openfootball-research-2.0":
        quality["offset_minute"] = 0
    for name, value in dict(matches=rows, history=rows, sources=[source], competitions=[edition], quality=quality,
                            polls=[poll]).items():
        write_json(root, name, value)
    manifest = original["manifest"]
    manifest["as_of"] = poll["observed_at"]
    write_json(root, "manifest", manifest)
    seal(root, update_gold=True)
    return root


def test_real_package_and_small_subset_preserve_unknown_time_and_score(package):
    research = OpenFootballResearch(package)
    assert len(research.payload["matches"]) == 2
    assert all(r["start_time"] is None and r["completed_at"] is None and r["timezone"] is None
               and r["prediction_eligible"] is False for r in research.payload["matches"])
    unknown = next(r for r in research.payload["matches"] if r["result_status"] == "unknown_result")
    assert unknown["score_a"] is None and unknown["score_b"] is None and unknown["local_time"] is None
    detail = research.match(unknown["match_id"])
    assert detail["forecast_status"] == "unavailable_unresolved_time_and_target"
    assert detail["history_basis"] == "retrospective_source_observations"
    assert detail["revisions"][0]["observed_at"].startswith("2026-10-06")


def test_parameterized_api_filters_and_source_dates_apply_before_pagination(package, tmp_path):
    research = OpenFootballResearch(package)
    agent = Copilot(default_fixture(), tmp_path / "agent")
    with TestClient(create_app(agent, research)) as client:
        assert client.get("/api/open-football/health").json()["predictions_available"] is False
        data = client.get("/api/open-football/snapshot").json()
        assert data["manifest"]["data_kind"] == "open_data" and len(data["matches"]) == 2
        first = client.get("/open-football/matches?limit=1&offset=0").json()
        second = client.get("/open-football/matches?limit=1&offset=1").json()
        assert first["total"] == 2 and first["rows"][0]["match_id"] != second["rows"][0]["match_id"]
        unknown = next(r for r in data["matches"] if r["result_status"] == "unknown_result")
        filtered = client.get("/open-football/matches", params={"result_status": "unknown_result",
            "date_from": unknown["source_date"], "date_to": unknown["source_date"], "team_id": unknown["team_a_id"]}).json()
        assert filtered["total"] == 1 and filtered["date_basis"] == "source_calendar_date"
        assert client.get("/open-football/matches", params={"search": "' OR 1=1 --"}).json()["rows"] == []
        assert client.get("/open-football/competitions?region=Europe").json()["total"] == 0
        assert client.get("/open-football/competitions/colombia-primera-a-2025").json()["total"] == 2
        assert client.get(f"/open-football/matches/{unknown['match_id']}").json()["match"]["score_a"] is None
        assert client.get("/open-football/matches/unlisted").status_code == 404
        assert client.get("/open-football/competitions/unlisted").status_code == 404
        assert client.get("/open-football/matches?limit=101").status_code == 422
        assert client.get("/open-football/matches?result_status=scheduled").status_code == 422
        assert client.get("/open-football/matches?date_from=2026-10-06&date_to=2025-01-01").status_code == 400
        assert client.get("/matches?limit=1").json()["data_kind"] == "synthetic"


@pytest.mark.parametrize("kind", ["clock", "score", "poll", "quality", "directory", "source", "revision"])
def test_resealed_semantic_tampering_is_rejected(package, kind):
    value = json.loads((package / "matches.json").read_text(encoding="utf-8"))
    if kind in ("clock", "score", "revision"):
        if kind == "clock":
            value[0]["start_time"] = value[0]["source_date"] + "T00:00:00Z"
        elif kind == "score":
            value[0]["score_a"] = 50
        else:
            value[0]["revision"] = 2
        write_json(package, "matches", value)
    else:
        name = {"poll": "polls", "quality": "quality", "directory": "competitions", "source": "sources"}[kind]
        value = json.loads((package / f"{name}.json").read_text(encoding="utf-8"))
        if kind == "poll":
            value[0]["changed"] = 0
        elif kind == "quality":
            value["unknown_results"] = 0
        elif kind == "directory":
            value[0]["match_count"] = 200
        else:
            value[0]["path"] = "2025/unauthorised.json"
        write_json(package, name, value)
    seal(package, update_gold=True)
    with pytest.raises(ResearchError):
        validate_research(package)


def test_checksum_extra_file_and_parquet_parity_fail_closed(package):
    path = package / "matches.json"
    original = path.read_bytes()
    path.write_bytes(original + b" ")
    with pytest.raises(ResearchError, match="Checksum"):
        validate_research(package)
    path.write_bytes(original)
    (package / "unlisted.json").write_text("[]")
    with pytest.raises(ResearchError, match="extra"):
        validate_research(package)
    (package / "unlisted.json").unlink()
    rows = json.loads(original)
    rows.reverse()
    write_json(package, "matches", rows)
    seal(package)
    with pytest.raises(ResearchError, match="Parquet disagree"):
        validate_research(package)


def test_duplicate_json_keys_fail_closed(package):
    (package / "manifest.json").write_bytes(b'{"research_version":"a","research_version":"b"}')
    with pytest.raises(ResearchError, match="Duplicate JSON key"):
        validate_research(package)


def test_queries_keep_validated_dataset_when_disk_file_changes_after_startup(package):
    research = OpenFootballResearch(package)
    before = research.matches()
    # The running reader owns its verified observations. A corrupted later file
    # cannot replace query values while retaining an earlier version/fingerprint.
    (package / "gold/matches.parquet").write_bytes(b"not parquet")
    after = research.matches()
    assert after == before and len(after["rows"]) == 2
    assert research.match(after["rows"][0]["match_id"])["match"] == after["rows"][0]
    with pytest.raises(ResearchError, match="Checksum"):
        OpenFootballResearch(package)


def test_unavailable_research_is_explicit_and_synthetic_api_remains_available(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_OPEN_FOOTBALL", str(tmp_path / "absent"))
    agent = Copilot(default_fixture(), tmp_path / "agent")
    with TestClient(create_app(agent)) as client:
        assert client.get("/open-football/health").status_code == 503
        assert client.get("/health").json()["data_kind"] == "synthetic"


def test_resealed_float_score_gold_schema_is_rejected(package):
    for name, table in (("matches", "matches"), ("history", "match_history")):
        rows = json.loads((package / f"{name}.json").read_text(encoding="utf-8"))
        known = next(r for r in rows if r["result_status"] == "observed_result")
        known["score_a"] = float(known["score_a"])
        excluded = {"edition_id", "revision", "event_id", "observed_at", "source_sha256", "source_url", "license", "license_url"}
        business = {k: v for k, v in known.items() if k not in excluded}
        known["event_id"] = f"{known['match_id']}:{known['revision']}:{sha(encode(business))[:16]}"
        write_json(package, name, rows)
        original = pq.read_schema(package / f"gold/{table}.parquet")
        schema = pa.schema([pa.field(f.name, pa.float64()) if f.name == "score_a" else f for f in original])
        pq.write_table(pa.Table.from_pylist(rows, schema=schema), package / f"gold/{table}.parquet")
    seal(package)
    with pytest.raises(ResearchError, match="schema"):
        validate_research(package)


@pytest.mark.parametrize("kind", ["quarantine_excess", "unknown_304_archive", "backwards_poll"])
def test_resealed_invalid_poll_evidence_is_rejected(package, kind):
    polls = json.loads((package / "polls.json").read_text(encoding="utf-8"))
    if kind == "quarantine_excess":
        polls[0]["quarantined"] = 1
        problems = [dict(source_id=polls[0]["source_id"], sha256=polls[0]["sha256"],
            row_index=index, reason="Unsupported source row", observed_at=polls[0]["observed_at"], raw_json="null")
            for index in (0, 1)]
        write_json(package, "quarantine", problems)
        quality = json.loads((package / "quality.json").read_text())
        quality["quarantine_rows"] = 2
        write_json(package, "quality", quality)
    else:
        old = polls[0]
        observed = datetime.fromisoformat(old["observed_at"].replace("Z", "+00:00"))
        later = (observed + timedelta(seconds=1) if kind == "unknown_304_archive" else observed - timedelta(seconds=1))
        newer = dict(old, poll_id=old["poll_id"] + 1, observed_at=later.isoformat().replace("+00:00", "Z"),
                     status="not_modified", changed=0, quarantined=0)
        if kind == "unknown_304_archive":
            newer["sha256"] = "f" * 64
            manifest = json.loads((package / "manifest.json").read_text())
            manifest["as_of"] = newer["observed_at"]
            write_json(package, "manifest", manifest)
        polls.append(newer)
    write_json(package, "polls", polls)
    seal(package)
    with pytest.raises(ResearchError, match="Quarantine|304|backwards"):
        validate_research(package)
