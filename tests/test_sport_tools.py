import json

import pytest

from arena_copilot.agent import Copilot, tool_excerpt
from arena_copilot.snapshot import default_fixture
from arena_copilot.tools import Tools


def test_typed_competition_tool_uses_canonical_name_and_id():
    tools = Tools(default_fixture())
    matches = tools.call("list_matches", {"sport": "valorant", "competition_name": "Atlantic Circuit"})
    assert matches["rows"] and all(r["competition"] == "Atlantic Circuit" for r in matches["rows"])
    key = matches["rows"][0]["competition_id"]
    result = tools.call("get_competition", {"competition_id": key})
    row = result["rows"][0]
    assert result["source"] == "gold/matches.parquet"
    assert row["competition"]["match_count"] == 100
    assert row["competition"]["score_unit"] == "maps" and row["teams_total"] == 8
    assert all(t["points"] is None for t in row["table"])
    assert tools.call("list_matches", {"competition_name": "' OR 1=1 --"})["rows"] == []
    with pytest.raises(ValueError):
        tools.call("get_competition", {"competition_id": key, "sql": "DROP TABLE matches"})
    with pytest.raises(ValueError):
        tools.call("get_competition", {"competition_id": "invalid-key"})


def test_match_context_tool_is_bounded_and_uses_history():
    row = Tools(default_fixture()).call("get_match_context", {"match_id": "synthetic:football:000598"})
    assert row["source"] == "gold/match_history.parquet" and len(row["rows"]) == 1
    context = row["rows"][0]
    assert context["match"]["score_a"] is None and context["match"]["score_unit"] == "goals"
    assert context["history_basis"] == "observation_history"
    assert context["form_a"]["played"] <= 5 and context["form_b"]["played"] <= 5
    assert context["head_to_head"]["total"] >= 0
    with pytest.raises(ValueError):
        Tools(default_fixture()).call("get_match_context", {"match_id": "synthetic:football:999999"})


def test_evidence_agent_resolves_one_named_competition_and_abstains_on_ambiguity(tmp_path):
    agent = Copilot(default_fixture(), tmp_path)
    response = agent.ask("Show the Harbor League competition standings", mode="evidence")
    assert not response["abstained"]
    assert response["tool_results"][0]["tool"] == "get_competition"
    assert all(r["points"] == r["wins"] * 3 + r["draws"]
               for r in response["tool_results"][0]["rows"][0]["table"])
    assert agent.ask("Show all event standings", mode="evidence")["abstained"]
    context = agent.ask("Read the form for synthetic:valorant:000599", mode="evidence")
    assert context["tool_results"][0]["tool"] == "get_match_context" and not context["abstained"]
    agent.close()


@pytest.mark.parametrize("native_route", [False, True])
@pytest.mark.parametrize("swapped", [False, True])
def test_forecast_outcome_association_on_direct_and_native_routes(tmp_path, monkeypatch, native_route, swapped):
    agent = Copilot(default_fixture(), tmp_path)
    requested = False

    def chat(messages, tools=None, output_schema=None):
        nonlocal requested
        if tools:
            if not requested:
                requested = True
                return {"message": {"role": "assistant", "tool_calls": [{"function": {
                    "name": "get_prediction", "arguments": {"match_id": "synthetic:valorant:000599"}}}]}}
            return {"message": {"role": "assistant", "content": "Read the stored forecast."}}
        values = ("66.29", "33.71") if swapped else ("33.71", "66.29")
        return {"message": {"content": json.dumps({
            "answer": f"Zero Latitude: {values[0]}%; Echo Division: {values[1]}%. Synthetic and uncalibrated.",
            "citation_ids": ["predictions.json"], "abstained": False})}}

    monkeypatch.setattr(agent, "_chat", chat)
    monkeypatch.setattr(agent, "model_digest", lambda: "test-model")
    question = "Explain the VALORANT forecast" if native_route else "Predict synthetic:valorant:000599"
    response = agent.ask(question, mode="ollama")
    assert response["abstained"] is swapped
    assert response["metrics"]["tool_calls"] == 1
    assert response["tool_results"][0]["tool"] == "get_prediction"
    agent.close()


def test_nested_competition_excerpt_respects_budget_without_mutating_evidence():
    tools = Tools(default_fixture())
    ident = tools.call("list_matches", {"sport": "football", "competition_name": "Harbor League"})["rows"][0]["competition_id"]
    result = tools.call("get_competition", {"competition_id": ident})
    original = json.dumps(result)
    assert len(original) > 1600
    excerpt = tool_excerpt(result)
    assert len(json.dumps(excerpt)) <= 1600 and excerpt["truncated"]
    assert excerpt["source"] == result["source"] and len(excerpt["rows"]) == 1
    assert excerpt["rows"][0]["table"]
    assert json.dumps(result) == original


def test_generative_match_context_is_preselected_before_model_planning(tmp_path, monkeypatch):
    agent = Copilot(default_fixture(), tmp_path)
    calls = []

    def chat(messages, tools=None, output_schema=None):
        calls.append(messages)
        assert tools is None and output_schema
        assert '"tool": "get_match_context"' in messages[0]["content"]
        assert '"history_basis": "observation_history"' in messages[0]["content"]
        return {"message": {"content": json.dumps({"answer": "The form uses recorded pre-match history.",
                "citation_ids": ["gold/match_history.parquet"], "abstained": False})}, "eval_count": 12}

    monkeypatch.setattr(agent, "_chat", chat)
    monkeypatch.setattr(agent, "model_digest", lambda: "test-model")
    result = agent.ask("Describe pre-match form for synthetic:football:000590", mode="ollama")
    assert not result["abstained"] and result["metrics"]["tool_calls"] == 1 and len(calls) == 1
    assert result["tool_results"][0]["tool"] == "get_match_context"
    unknown = agent.ask("Describe pre-match form for synthetic:football:999999", mode="ollama")
    assert unknown["abstained"] and unknown["metrics"]["generated_tokens"] == 0 and len(calls) == 1
    agent.close()
