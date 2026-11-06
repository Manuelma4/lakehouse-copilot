"""Research workflow checks with model doubles; actual inference is separate."""

import json
import sqlite3

import pytest

from arena_copilot.observability import Observability
from arena_copilot.openfootball import OpenFootballResearch, default_research
from arena_copilot.research_agent import ResearchCopilot, ResearchTools


@pytest.fixture(scope="module")
def research():
    return OpenFootballResearch(default_research())


class ModelDouble:
    request_timeout = 30
    model = "fixture-model"

    def __init__(self, replies=()):
        self.observability = Observability()
        self.replies = iter(replies)
        self.requests = []

    def _chat(self, messages, tools=None, output_schema=None):
        self.requests.append(dict(messages=messages, tools=tools, output_schema=output_schema))
        return next(self.replies)

    def model_digest(self):
        return "fixture-digest"


def response(answer, citations, abstained=False):
    return dict(message=dict(content=json.dumps(dict(answer=answer, citation_ids=citations, abstained=abstained))),
                eval_count=12)


def test_real_research_evidence_is_scoped_and_persisted(research, tmp_path):
    model = ModelDouble()
    agent = ResearchCopilot(research, model, tmp_path)
    target = research.payload["matches"][0]
    try:
        result = agent.ask("Inspect this source match", mode="evidence", match_id=target["match_id"])
        assert not model.requests and result["model"] is None and not result["abstained"]
        assert result["data_kind"] == "open_data" and result["provider"] == "openfootball"
        assert result["dataset_version"] == research.manifest["dataset_version"]
        assert result["snapshot_fingerprint"] == research.fingerprint
        assert result["tool_results"][0]["rows"][0]["match_id"] == target["match_id"]
        assert result["citations"][0]["id"] == "gold/match_history.parquet"
        with sqlite3.connect(agent.trace_db) as db:
            stored = json.loads(db.execute("SELECT response FROM traces WHERE trace_id=?", [result["trace_id"]]).fetchone()[0])
        assert stored == result
        agent.feedback(result["trace_id"], 1, "Reviewed source evidence")
        with pytest.raises(ValueError, match="Unknown research trace"):
            agent.feedback("0" * 32, 1)
    finally:
        agent.close()


def test_forecasts_abstain_before_any_model_call(research, tmp_path):
    model = ModelDouble()
    agent = ResearchCopilot(research, model, tmp_path)
    try:
        result = agent.ask("Predict the winner and probabilities for Mexico", mode="ollama")
        assert result["abstained"] and not model.requests
        assert result["metrics"]["tool_calls"] == 1 and result["model_digest"] is None
        assert [c["id"] for c in result["citations"]] == ["quality.json"]
        assert "pre-match availability" in result["answer"]
    finally:
        agent.close()


@pytest.mark.parametrize("answer,citations,accepted", [
    ("Inspect the source FT and extra-time stages separately.", ["gold/match_history.parquet"], True),
    ("The synthetic forecast is 100% certain.", ["gold/match_history.parquet"], False),
    ("A prediction is available.", ["predictions.json"], False),
    ("This match is finished.", [], False),
])
def test_generation_validates_source_scope_and_rejects_unsupported_percentages(research, tmp_path, answer, citations, accepted):
    model = ModelDouble([response(answer, citations)])
    agent = ResearchCopilot(research, model, tmp_path)
    try:
        result = agent.ask("Explain these score stages", match_id=research.payload["matches"][0]["match_id"])
        assert len(model.requests) == 1 and model.requests[0]["output_schema"]
        assert (not result["abstained"]) is accepted
        assert result["metrics"]["tool_calls"] == 1
    finally:
        agent.close()


def test_tool_limit_and_write_arguments_have_no_operation(research, tmp_path):
    tools = ResearchTools(research)
    with pytest.raises(ValueError):
        tools.call("execute_sql", {"sql": "DELETE FROM matches"})
    with pytest.raises(ValueError):
        tools.call("research_matches", {"sql": "DROP TABLE matches"})
    planned = dict(message=dict(tool_calls=[dict(function=dict(name="research_matches", arguments={})) for _ in range(7)]),
                   eval_count=9)
    model = ModelDouble([planned])
    agent = ResearchCopilot(research, model, tmp_path)
    try:
        result = agent.ask("Investigate football sources")
        assert result["abstained"] and "six-tool limit" in result["answer"]
        assert result["metrics"]["tool_calls"] == 0 and not result["tool_results"]
        with pytest.raises(ValueError, match="at most one"):
            agent.ask("Inspect", match_id="x", team_id="y")
    finally:
        agent.close()


def test_unknown_context_abstains_with_no_model_and_no_foreign_citation(research, tmp_path):
    model = ModelDouble()
    agent = ResearchCopilot(research, model, tmp_path)
    try:
        result = agent.ask("Explain this match", match_id="openfootball:match:" + "0" * 24)
        assert result["abstained"] and not model.requests and not result["citations"]
    finally:
        agent.close()
