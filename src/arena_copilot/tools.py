"""Fixed, parameterized analytical queries; no tool accepts SQL or write operations."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

import duckdb
from pydantic import BaseModel, ConfigDict, Field


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sport: Literal["football", "valorant"] | None = None
    team_name: str | None = Field(default=None, max_length=100)
    match_id: str | None = Field(default=None, max_length=120)
    competition_id: str | None = Field(default=None, pattern=r"^(football|valorant)-[0-9a-f]{16}$")
    competition_name: str | None = Field(default=None, max_length=120)
    status: Literal["scheduled", "running", "finished", "cancelled", "postponed"] | None = None


TOOL_NAMES = ("list_matches", "get_team_stats", "get_prediction", "get_incidents", "get_lineage", "get_catalog",
              "get_competition", "get_match_context")


class Tools:
    def __init__(self, snapshot: Path):
        self.snapshot = Path(snapshot)

    def read_json(self, name):
        return json.loads((self.snapshot / name).read_text(encoding="utf-8"))

    def sports(self):
        from .analytics import sports_catalog
        if not hasattr(self, "_sports_agent"):
            self._sports_agent = SimpleNamespace(snapshot=self.snapshot, manifest=self.read_json("manifest.json"), tools=self)
        return sports_catalog(self._sports_agent)

    def call(self, name: str, raw_args: dict) -> dict:
        if name not in TOOL_NAMES:
            raise ValueError("Unknown or forbidden tool")
        args = Args.model_validate(raw_args)
        permitted = {
            "list_matches": {"sport", "team_name", "status", "competition_name"}, "get_team_stats": {"sport", "team_name"},
            "get_prediction": {"match_id"}, "get_incidents": set(), "get_lineage": set(), "get_catalog": set(),
            "get_competition": {"competition_id"}, "get_match_context": {"match_id"},
        }
        if set(raw_args) - permitted[name]:
            raise ValueError("Unexpected tool arguments")
        if name in ("get_competition", "get_match_context"):
            try:
                if name == "get_competition":
                    if not args.competition_id:
                        raise ValueError("get_competition requires competition_id")
                    detail = self.sports().competition_detail(args.competition_id, limit=10)
                    summary = {k: v for k, v in detail["competition"].items() if k != "participants"}
                    table = [{k: v for k, v in row.items() if k not in ("form", "identity_source")}
                             for row in detail["table"][:20]]
                    return dict(source="gold/matches.parquet", rows=[dict(competition=summary,
                        table=table, table_label=detail["table_label"], teams_total=len(detail["table"]))])
                if not args.match_id:
                    raise ValueError("get_match_context requires match_id")
                detail = self.sports().match_detail(args.match_id)
                match = {k: detail["match"].get(k) for k in ("match_id", "sport", "competition", "team_a", "team_b",
                         "start_time", "status", "score_a", "score_b", "best_of", "score_unit")}
                def form(value):
                    return {k: value[k] for k in ("team_id", "team_name", "played", "wins", "draws", "losses")}
                h2h = {k: v for k, v in detail["head_to_head"].items() if k != "rows"}
                return dict(source="gold/match_history.parquet" if detail["history_basis"] == "observation_history"
                            else "gold/matches.parquet", rows=[dict(match=match, cutoff=detail["cutoff"],
                    history_basis=detail["history_basis"], history_label=detail["history_label"],
                    form_a=form(detail["form_a"]), form_b=form(detail["form_b"]), head_to_head=h2h)],
                    status="available")
            except KeyError as error:
                raise ValueError("Unknown competition or match ID") from error
        if name in ("get_incidents", "get_lineage", "get_catalog"):
            file = {"get_incidents": "incidents.json", "get_lineage": "lineage.json", "get_catalog": "catalog.json"}[name]
            return dict(source=file, rows=self.read_json(file))
        if name == "get_prediction":
            if not args.match_id:
                raise ValueError("get_prediction requires match_id")
            rows = [p for p in self.read_json("predictions.json") if p["match_id"] == args.match_id]
            return dict(source="predictions.json", rows=rows,
                        status="available" if rows else "unavailable_or_insufficient_history")
        table = "matches" if name == "list_matches" else "team_stats"
        conditions, values = [], [str(self.snapshot / f"gold/{table}.parquet")]
        if args.sport:
            conditions.append("sport = ?")
            values.append(args.sport)
        if args.team_name:
            conditions.append("(lower(team_a)=lower(?) OR lower(team_b)=lower(?))" if table == "matches"
                              else "lower(team_name)=lower(?)")
            values.extend([args.team_name] * (2 if table == "matches" else 1))
        if args.status:
            conditions.append("status = ?")
            values.append(args.status)
        if args.competition_name:
            conditions.append("lower(competition)=lower(?)")
            values.append(args.competition_name)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        order = "start_time DESC,match_id" if table == "matches" else "win_rate DESC,team_id"
        with duckdb.connect(":memory:") as db:
            result = db.execute(f"SELECT * FROM read_parquet(?) {where} ORDER BY {order} LIMIT 30", values)
            names = [c[0] for c in result.description]
            rows = [dict(zip(names, row)) for row in result.fetchall()]
        if table == "matches":
            from .sports import competition_id
            rows = [dict(row, competition_id=competition_id(row["sport"], row["competition"])) for row in rows]
        return dict(source=f"gold/{table}.parquet", rows=rows)


def ollama_tool_definitions():
    return [dict(type="function", function=dict(name=name,
        description={"list_matches": "List matches and their competition IDs; filter by sport, exact competition name, team name or status",
                     "get_team_stats": "Get finished-match team stats by sport and exact team name",
                     "get_prediction": "Read precomputed model probabilities for an exact match_id; never invent them",
                     "get_incidents": "Read current data-quality incidents",
                     "get_lineage": "Read data lineage",
                     "get_catalog": "Read table schemas",
                     "get_competition": "Read a competition's observed coverage and computed team table by its exact competition_id; not official standings",
                     "get_match_context": "Read an exact match and pre-match form/head-to-head reconstructed from source observations before kickoff"}[name],
        parameters=dict(type="object", properties={
            **({"match_id": {"type": "string"}} if name in ("get_prediction", "get_match_context") else {}),
            **({"competition_id": {"type": "string"}} if name == "get_competition" else {}),
            **({"sport": {"type": "string", "enum": ["football", "valorant"]},
                "team_name": {"type": "string"}} if name in ("list_matches", "get_team_stats") else {}),
            **({"status": {"type": "string", "enum": ["scheduled", "running", "finished"]}} if name == "list_matches" else {}),
            **({"competition_name": {"type": "string"}} if name == "list_matches" else {}),
        }, required=["match_id"] if name in ("get_prediction", "get_match_context") else
                    ["competition_id"] if name == "get_competition" else [], additionalProperties=False)))
        for name in TOOL_NAMES]
