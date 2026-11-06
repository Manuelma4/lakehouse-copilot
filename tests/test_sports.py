import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot
from arena_copilot.analytics import public_snapshot, sports_catalog, table_rows
from arena_copilot.api import create_app
from arena_copilot.snapshot import default_fixture
from arena_copilot.sports import SportsCatalog, checked_dates, competition_id


def domain_fixture():
    """Original small independent oracle: same names, reversed sides, late fixes."""
    def match(ident, day, a="A", b="B", sa=1, sb=0, *, comp="Circuit Été / Δ !", sport="football"):
        return dict(match_id=ident, event_id=f"{ident}:2", revision=2, provider="synthetic", sport=sport,
            competition=comp, team_a_id=a, team_b_id=b, team_a="Same Club" if a in ("A", "B") else a,
            team_b="Same Club" if b in ("A", "B") else b, start_time=f"2025-01-{day:02d}T12:00:00Z",
            completed_at=f"2025-01-{day:02d}T14:00:00Z", observed_at=f"2025-01-{day:02d}T14:10:00Z",
            status="finished", score_a=sa, score_b=sb, best_of=1 if sport == "football" else 3)
    one = match("one", 1)
    two = match("two", 3, a="B", b="A", sa=2, sb=1)
    corrected = dict(two, event_id="two:3", revision=3, score_a=0, score_b=4, observed_at="2025-01-09T12:00:00Z")
    draw = match("draw", 5, b="C", sa=0, sb=0)
    target = match("target", 8, sa=2, sb=0)
    future = dict(match("upcoming", 12), status="scheduled", revision=1, event_id="upcoming:1",
                  completed_at=None, observed_at="2025-01-10T00:00:00Z", score_a=None, score_b=None)
    equal = match("equal", 7, a="A", b="D")
    equal.update(completed_at="2025-01-08T12:00:00Z", observed_at="2025-01-08T12:00:00Z")
    observed_late = match("late-known", 2, a="A", b="E")
    observed_late["observed_at"] = "2025-01-09T15:00:00Z"
    other = match("other", 4, a="A", b="F", comp="Other League")
    cancelled = dict(match("cancelled", 6, a="G", b="H"), status="cancelled", score_a=None, score_b=None, completed_at=None)
    val = match("series", 4, a="A", b="B", sport="valorant", comp="Neon Open", sa=2, sb=1)
    matches = [one, corrected, draw, target, future, equal, observed_late, other, cancelled, val]
    history = [one, two, corrected, draw, target, future, equal, observed_late, other, cancelled, val]
    manifest = dict(as_of="2025-01-10T15:00:00Z", data_kind="synthetic", dataset_version="test-domain")
    predictions = [dict(match_id="upcoming", sport="football", probabilities={"a": 0.5, "b": 0.3, "draw": 0.2},
                        model="fixture_stored", data_kind="synthetic", as_of=manifest["as_of"])]
    return dict(matches=matches, history=history, manifest=manifest, predictions=predictions)


def catalog():
    return SportsCatalog(**domain_fixture())


def test_showcase_contains_six_truthful_competitions_and_full_pagination(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    with TestClient(create_app(agent)) as client:
        response = client.get("/api/competitions?limit=2&offset=0")
        assert response.status_code == 200
        first = response.json()
        assert first["total"] == 6 and len(first["rows"]) == 2
        all_events = client.get("/competitions?limit=100").json()["rows"]
        assert {r["sport"] for r in all_events} == {"football", "valorant"}
        assert all(r["match_count"] == 100 for r in all_events)
        second = client.get("/competitions?limit=2&offset=2").json()
        assert {r["competition_id"] for r in first["rows"]}.isdisjoint(r["competition_id"] for r in second["rows"])
        event = next(r for r in all_events if r["sport"] == "football")
        ident = event["competition_id"]
        detail = client.get(f"/competitions/{ident}?limit=7&offset=7&order=asc").json()
        assert detail["total"] == 100 and len(detail["rows"]) == 7
        assert len(detail["table"]) == 8 and detail["competition"]["competition_id"] == ident
        assert sum(r["played"] for r in detail["table"]) == 2 * event["completed_matches"]
        assert detail["table_label"] == "Observed results table — not official standings"
        filtered = client.get("/matches", params={"competition_id": ident, "limit": 2, "order": "asc"}).json()
        assert filtered["total"] == 100
        assert all(r["competition_id"] == ident for r in filtered["rows"])
        assert client.get("/competitions/unknown").status_code == 404
        assert client.get("/matches/unknown").status_code == 404


def test_competition_points_and_identity_are_scoped_and_not_official():
    domain = catalog()
    table = domain.table(competition_id("football", "Circuit Été / Δ !"))
    by_id = {r["team_id"]: r for r in table}
    assert by_id["A"]["points"] == 3 * by_id["A"]["wins"] + by_id["A"]["draws"]
    assert by_id["A"]["played"] == 6  # other-competition result is excluded
    assert by_id["B"]["played"] == 3
    assert by_id["A"]["team_name"] == by_id["B"]["team_name"] == "Same Club"
    assert by_id["A"]["team_key"] != by_id["B"]["team_key"]
    assert by_id["G"]["played"] == by_id["H"]["played"] == 0
    series = domain.table(competition_id("valorant", "Neon Open"))
    assert {r["points"] for r in series} == {None}
    assert sum(r["draws"] for r in series) == 0
    assert sum(r["score_for"] for r in series) == 3  # maps, no fabricated rounds


def test_pre_match_form_reconstructs_known_revision_and_orients_h2h():
    detail = catalog().match_detail("target")
    assert detail["history_basis"] == "observation_history"
    assert detail["cutoff"] == "2025-01-08T12:00:00+00:00"
    assert [r["match_id"] for r in detail["form_a"]["rows"]] == ["draw", "other", "two", "one"]
    assert [r["result"] for r in detail["form_a"]["rows"]] == ["D", "W", "L", "W"]
    assert detail["head_to_head"]["total"] == 2
    assert detail["head_to_head"]["team_a_wins"] == detail["head_to_head"]["team_b_wins"] == 1
    assert detail["head_to_head"]["rows"][0]["score_a"] == 2  # historical B vs A, before correction
    assert "target" not in [r["match_id"] for r in detail["head_to_head"]["rows"]]
    assert all(r["match_id"] not in ("equal", "late-known", "upcoming") for r in detail["form_a"]["rows"])
    future = catalog().match_detail("upcoming")
    assert future["prediction"]["model"] == "fixture_stored"
    assert future["head_to_head"]["rows"][1]["score_b"] == 4  # correction known at snapshot cutoff


def test_without_history_context_is_conservative_and_explicit():
    fixture = domain_fixture()
    fixture["history"] = None
    detail = SportsCatalog(**fixture).match_detail("target")
    assert detail["history_basis"] == "current_rows_only"
    assert "earlier corrected versions may be missing" in detail["history_label"]
    assert "two" not in [r["match_id"] for r in detail["form_a"]["rows"]]
    assert detail["head_to_head"]["total"] == 1


def test_snapshot_status_uses_cutoff_not_wall_clock():
    domain = catalog()
    assert domain.match_row(domain.by_id["upcoming"])["snapshot_status"] == "upcoming"
    stale = dict(domain.by_id["upcoming"], start_time="2025-01-01T00:00:00Z")
    assert domain.match_row(stale)["snapshot_status"] == "overdue"
    assert domain.match_row(domain.by_id["target"])["snapshot_status"] == "completed"


def test_date_groups_use_actual_utc_instants_and_half_day_boundaries():
    fixture = domain_fixture()
    moved = dict(fixture["matches"][0], start_time="2025-01-02T23:30:00-02:00")
    fixture["matches"][0] = moved
    domain = SportsCatalog(**fixture)
    rows = domain.fixtures(date_from="2025-01-03", date_to="2025-01-03", order="asc")
    assert {r["match_id"] for r in rows["rows"]} == {"one", "two"}
    assert [g["date"] for g in rows["date_groups"]] == ["2025-01-03"]
    assert rows["rows"][0]["match_id"] == "one"
    with pytest.raises(ValueError):
        checked_dates("2025-01-04", "2025-01-03")
    with pytest.raises(ValueError):
        checked_dates("2025-01-01", "2027-01-01")


def test_unambiguous_gold_identity_fallback_never_merges_names_with_multiple_ids():
    fixture = domain_fixture()
    for row in fixture["matches"]:
        row.pop("team_a_id", None)
        row.pop("team_b_id", None)
    domain = SportsCatalog(**fixture, team_rows=[dict(sport="football", team_name="Same Club", team_id="A"),
        dict(sport="football", team_name="Same Club", team_id="B"), dict(sport="football", team_name="C", team_id="C")])
    assert domain.identity(domain.by_id["one"], "a")["identity_source"] == "unresolved"
    assert domain.identity(domain.by_id["draw"], "b")["identity_source"] == "gold_unique_name"
    detail = domain.match_detail("target")
    assert detail["head_to_head"]["total"] == 0
    assert "one" not in [r["match_id"] for r in detail["form_a"]["rows"]]


def test_api_filters_are_parameterized_and_counts_use_full_scope(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    with TestClient(create_app(agent)) as client:
        assert client.get("/matches", params={"competition_id": "' OR 1=1 --"}).json()["total"] == 0
        assert client.get("/matches", params={"search": "' OR 1=1 --"}).json()["total"] == 0
        page = client.get("/matches", params={"sport": "valorant", "date_from": "2025-01-10",
                "date_to": "2025-01-20", "limit": 2, "offset": 0, "order": "asc"}).json()
        rows, total = table_rows(agent.snapshot, "matches", sport="valorant", date_from="2025-01-10",
            date_to="2025-01-20", limit=1000, order="asc")
        assert page["total"] == total > 2
        assert [r["match_id"] for r in page["rows"]] == [r["match_id"] for r in rows[:2]]
        assert client.get("/matches?date_from=2025-01-20&date_to=2025-01-10").status_code == 400
        assert client.get("/matches?date_from=banana").status_code == 422
        future = client.get("/matches?sport=valorant&status=scheduled&order=asc").json()["rows"]
        detail = client.get(f"/matches/{future[0]['match_id']}").json()
        assert detail["prediction"] and detail["snapshot_fingerprint"]
        assert detail["history_basis"] == "observation_history"


def test_public_domain_context_equals_full_api_scope_without_fixture_mutation(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    public = public_snapshot(agent)
    assert len(public["match_history"]) == 1192
    assert len(public["competitions"]) == 6
    recreated = SportsCatalog(public["matches"], public["manifest"], public["teams"], public["match_history"], public["predictions"])
    server = sports_catalog(agent)
    for ident in ("synthetic:football:000040", "synthetic:valorant:000599"):
        assert recreated.match_detail(ident) == server.match_detail(ident)
    for event in public["competitions"]:
        assert recreated.table(event["competition_id"]) == server.table(event["competition_id"])
    agent.close()


def test_future_revision_changes_do_not_change_earlier_context():
    fixture = domain_fixture()
    original = SportsCatalog(**fixture).match_detail("target")
    altered = copy.deepcopy(fixture)
    for row in altered["history"]:
        if row["match_id"] == "two" and row["revision"] == 3:
            row["score_a"], row["score_b"] = 9, 0
    future = SportsCatalog(**altered).match_detail("target")
    assert future["form_a"] == original["form_a"]
    assert future["head_to_head"] == original["head_to_head"]


def test_stable_unicode_competition_ids_have_exact_utf8_parity():
    assert competition_id("football", "Circuit Été / Δ !") == "football-f1e4159b16f029c0"
    assert competition_id("football", "Circuit Été / Δ !") != competition_id("football", "circuit Été / Δ !")
    assert competition_id("football", "Neon Open") != competition_id("valorant", "Neon Open")
    assert datetime.fromisoformat("2025-01-02T23:30:00-02:00").astimezone(timezone.utc).date().isoformat() == "2025-01-03"


def test_submillisecond_availability_never_leaks_after_cutoff():
    fixture = domain_fixture()
    target = next(r for r in fixture["matches"] if r["match_id"] == "target")
    target["start_time"] = "2025-01-08T12:00:00.000500Z"
    late = dict(fixture["matches"][0], match_id="fraction-later", completed_at="2025-01-08T11:00:00Z",
                observed_at="2025-01-08T12:00:00.000600Z")
    early = dict(late, match_id="fraction-earlier", observed_at="2025-01-08T12:00:00.000400Z")
    fixture["history"] += [late, early]
    detail = SportsCatalog(**fixture).match_detail("target")
    form_ids = [r["match_id"] for r in detail["form_a"]["rows"]]
    assert "fraction-earlier" in form_ids
    assert "fraction-later" not in form_ids


def test_shared_contract_examples_match_manually_defined_domain_oracle():
    fixture = json.loads((Path(__file__).parent / "fixtures/sports-domain.json").read_text(encoding="utf-8"))
    expected = fixture.pop("expected")
    domain = SportsCatalog(**fixture)
    historic = domain.match_detail(expected["historical_match_id"])
    assert historic["cutoff"] == expected["historic_cutoff"]
    assert [r["match_id"] for r in historic["form_a"]["rows"]] == expected["historic_form_a_ids"]
    assert [r["result"] for r in historic["form_a"]["rows"]] == expected["historic_form_a_results"]
    assert historic["head_to_head"]["total"] == expected["historic_h2h_total"]
    future = domain.match_detail(expected["future_match_id"])
    assert [r["match_id"] for r in future["form_a"]["rows"]] == expected["future_form_a_ids"]
    assert future["head_to_head"]["team_a_wins"] == expected["future_h2h_a_wins"]
    table = {r["team_id"]: r for r in domain.table(expected["competition_id"])}
    assert table["A"]["points"] == expected["competition_team_a_points"]
    assert table["A"]["played"] == expected["competition_team_a_played"]
    assert table["B"]["played"] == expected["competition_team_b_played"]
