"""Read-only, parameterized web queries over a verified immutable snapshot."""

import json
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

import duckdb

from .sports import SportsCatalog, checked_dates


def envelope(agent, rows, **extra):
    return dict(dataset_version=agent.manifest["dataset_version"],
                snapshot_fingerprint=agent.snapshot_fingerprint,
                data_kind=agent.manifest["data_kind"], as_of=agent.manifest["as_of"], rows=rows, **extra)


def table_rows(snapshot: Path, table: str, sport=None, team_name=None, status=None, limit=1000, offset=0,
               *, competition_id=None, competition=None, search=None, date_from=None, date_to=None, order="desc"):
    if table not in ("matches", "team_stats"):
        raise ValueError("Unknown analytical table")
    conditions, params = [], [str(snapshot / f"gold/{table}.parquet")]
    if sport:
        conditions.append("sport = ?")
        params.append(sport)
    if team_name:
        conditions.append("(lower(team_a)=lower(?) OR lower(team_b)=lower(?))" if table == "matches"
                          else "lower(team_name)=lower(?)")
        params.extend([team_name] * (2 if table == "matches" else 1))
    if status:
        conditions.append("status = ?")
        params.append(status)
    if table == "matches":
        if competition_id:
            conditions.append("(sport || '-' || substr(sha256(competition),1,16)) = ?")
            params.append(competition_id)
        if competition:
            conditions.append("competition = ?")
            params.append(competition)
        if search:
            conditions.append("contains(lower(team_a || ' ' || team_b || ' ' || competition || ' ' || match_id), lower(?))")
            params.append(search)
        begin, end = checked_dates(date_from, date_to)
        if begin:
            conditions.append("CAST(start_time AS TIMESTAMPTZ) >= ?")
            params.append(datetime.combine(begin, time.min, timezone.utc))
        if end:
            conditions.append("CAST(start_time AS TIMESTAMPTZ) < ?")
            params.append(datetime.combine(end + timedelta(days=1), time.min, timezone.utc))
    if order not in ("asc", "desc"):
        raise ValueError("Match order must be asc or desc")
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    ordering = f"CAST(start_time AS TIMESTAMPTZ) {order.upper()},match_id" if table == "matches" else "win_rate DESC,team_id"
    with duckdb.connect(":memory:") as connection:
        total = connection.execute(f"SELECT COUNT(*) FROM read_parquet(?) {where}", params).fetchone()[0]
        result = connection.execute(f"SELECT * FROM read_parquet(?) {where} ORDER BY {ordering} LIMIT ? OFFSET ?",
                                    params + [limit, offset])
        columns = [field[0] for field in result.description]
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return rows, total


def sports_catalog(agent):
    """Cache bounded full immutable Gold scope, never a paginated history page."""
    cached = getattr(agent, "_sports_catalog", None)
    if cached is not None:
        return cached
    matches, total = table_rows(agent.snapshot, "matches", limit=100_001)
    teams, team_total = table_rows(agent.snapshot, "team_stats", limit=100_001)
    if total > 100_000 or team_total > 100_000:
        raise ValueError("Sports analysis is bounded to 100000 canonical matches/team rows")
    history = None
    source = agent.snapshot / "gold/match_history.parquet"
    if source.is_file():
        with duckdb.connect(":memory:") as connection:
            count = connection.execute("SELECT COUNT(*) FROM read_parquet(?)", [str(source)]).fetchone()[0]
            if count > 200_000:
                raise ValueError("Sports point-in-time analysis is bounded to 200000 history rows")
            result = connection.execute("SELECT * FROM read_parquet(?) ORDER BY match_id,revision", [str(source)])
            columns = [field[0] for field in result.description]
            history = [dict(zip(columns, row)) for row in result.fetchall()]
    catalog = SportsCatalog(matches, agent.manifest, teams, history, agent.tools.read_json("predictions.json"))
    agent._sports_catalog = catalog
    return catalog


def public_snapshot(agent):
    """Only original synthetic fixtures may enter the free public website."""
    if agent.manifest["data_kind"] != "synthetic" or agent.manifest["providers"] != ["synthetic"]:
        raise ValueError("Public build exports only original synthetic data; provider data stays private")
    matches, total = table_rows(agent.snapshot, "matches", limit=5000)
    if total > len(matches):
        raise ValueError("Public demo is limited to 5,000 canonical matches; choose a smaller snapshot")
    teams, _ = table_rows(agent.snapshot, "team_stats", limit=5000)
    sports = sports_catalog(agent)
    if sports.history is not None and len(sports.history) > 50_000:
        raise ValueError("Public demo is limited to 50000 observation history rows")
    return dict(manifest=agent.manifest, snapshot_fingerprint=agent.snapshot_fingerprint,
        matches=matches, teams=teams, predictions=agent.tools.read_json("predictions.json"),
        model_report=agent.tools.read_json("model_report.json"), quality=agent.tools.read_json("quality.json"),
        incidents=agent.tools.read_json("incidents.json"), catalog=agent.tools.read_json("catalog.json"),
        lineage=agent.tools.read_json("lineage.json"), documents=agent.retriever.documents,
        match_history=sports.history,
        sports_contract=dict(version="sports-1.0", competition_id="sport + '-' + sha256(exact competition UTF8)[:16]",
            coverage_label="Observed snapshot coverage", table_label="Observed results table — not official standings",
            history_basis="observation_history" if sports.history is not None else "current_rows_only"),
        competitions=sports.competitions(limit=1000)["rows"])


def write_public_snapshot(agent, output: Path):
    payload = public_snapshot(agent)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8", newline="\n")
    return payload
