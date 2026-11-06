"""Source-label query regressions over the verified, immutable CC0 package."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arena_copilot.agent import Copilot
from arena_copilot.api import create_app
from arena_copilot.openfootball import OpenFootballResearch, default_research
from arena_copilot.snapshot import default_fixture


@pytest.fixture(scope="module")
def research():
    return OpenFootballResearch(default_research())


def ids(rows):
    return [row["match_id"] for row in rows]


def ordered(rows):
    return sorted(rows, key=lambda row: (-int(row["source_date"].replace("-", "")),
                                         row["local_time"] or "", row["match_id"]))


def test_exact_source_labels_apply_before_count_and_pagination(research):
    expected = ordered([row for row in research.payload["matches"]
                        if row["edition_id"] == "worldcup-2026" and row["source_group"] == "Group A"])
    assert len(expected) == 6
    pages = [research.matches(edition_id="worldcup-2026", source_group="Group A", limit=2, offset=offset)
             for offset in (0, 2, 4)]
    assert all(page["total"] == 6 for page in pages)
    assert ids([row for page in pages for row in page["rows"]]) == ids(expected)
    knockout = research.matches(edition_id="worldcup-2026", round="Round of 32", limit=100)
    assert knockout["total"] == 16
    assert all(row["round"] == "Round of 32" for row in knockout["rows"])
    assert research.matches(source_group="group a")["total"] == 0
    assert research.matches(round="round of 32")["total"] == 0
    assert research.matches(source_group="Group A' OR 1=1 --")["total"] == 0


def test_group_round_date_status_search_and_stable_team_identity_combine(research):
    mexico = next(team for team in research.payload["teams"]
                  if team["team_name"] == "Mexico" and team["team_type"] == "national")
    group = research.matches(edition_id="worldcup-2026", source_group="Group A", team_id=mexico["team_id"])
    assert group["total"] == 3
    day = research.matches(edition_id="worldcup-2026", source_group="Group A", round="Matchday 1",
                           date_from="2026-06-11", date_to="2026-06-11", result_status="observed_result")
    assert day["total"] == 2
    assert research.matches(edition_id="worldcup-2026", source_group="Group A",
                            result_status="unknown_result")["total"] == 0
    searched = research.matches(edition_id="worldcup-2026", search="Group A", limit=100)
    assert searched["total"] == 6
    assert all(row["source_group"] == "Group A" for row in searched["rows"])
    assert research.team(mexico["team_id"], source_group="Group A")["total"] == 3
    assert research.competition("worldcup-2026", round="Round of 32")["total"] == 16


def test_legacy_source_without_groups_returns_an_empty_exact_filter():
    old = OpenFootballResearch(Path(__file__).parent / "fixtures/research_v1")
    assert old.matches(source_group="Group A")["total"] == 0
    assert old.matches()["total"] > 0


def test_source_filter_routes_are_additive_and_bounded(research, tmp_path, monkeypatch):
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "")
    agent = Copilot(default_fixture(), tmp_path / "agent")
    mexico = next(team for team in research.payload["teams"]
                  if team["team_name"] == "Mexico" and team["team_type"] == "national")
    with TestClient(create_app(agent, research)) as client:
        response = client.get("/api/open-football/matches", params={
            "edition_id": "worldcup-2026", "source_group": "Group A", "limit": 2, "offset": 2})
        assert response.status_code == 200
        assert response.json()["total"] == 6 and len(response.json()["rows"]) == 2
        assert client.get("/api/open-football/competitions/worldcup-2026",
                          params={"round": "Round of 32"}).json()["total"] == 16
        assert client.get(f"/api/open-football/teams/{mexico['team_id']}",
                          params={"source_group": "Group A"}).json()["total"] == 3
        assert client.get("/api/open-football/matches", params={"source_group": "x" * 121}).status_code == 422
        assert client.get("/api/open-football/matches", params={"round": "x" * 121}).status_code == 422
        assert client.get("/api/open-football/matches", params={"edition_id": "colombia-primera-a-2025",
                          "result_status": "unknown_result"}).json()["total"] == 33
