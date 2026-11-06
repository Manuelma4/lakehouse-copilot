"""Truthful sport-domain views over immutable Gold observations.

These are observed fixture/results directories and points calculations, not an
official event calendar or complete league standings. Pre-match context uses
revision availability as well as completion time, never today's corrected result
when that revision was not known at the selected match cutoff.
"""

import hashlib
from datetime import date, timedelta

from .snapshot import utc_time

CONTRACT_VERSION = "sports-1.0"
COVERAGE_LABEL = "Observed snapshot coverage"
TABLE_LABEL = "Observed results table — not official standings"


def competition_id(sport, name):
    return f"{sport}-{hashlib.sha256(name.encode('utf-8')).hexdigest()[:16]}"


def checked_dates(date_from=None, date_to=None):
    begin = date.fromisoformat(date_from) if isinstance(date_from, str) else date_from
    end = date.fromisoformat(date_to) if isinstance(date_to, str) else date_to
    if begin and end and not timedelta(0) <= end - begin <= timedelta(days=366):
        raise ValueError("Date filters must be ordered and cover at most 366 days")
    return begin, end


def ordered_matches(rows, order="desc"):
    if order not in ("asc", "desc"):
        raise ValueError("Match order must be asc or desc")
    # Stable secondary key avoids locale-dependent sorting and page boundaries.
    rows = sorted(rows, key=lambda r: r["match_id"])
    return sorted(rows, key=lambda r: utc_time(r["start_time"]), reverse=order == "desc")


def paginated(rows, limit, offset):
    if type(limit) is not int or type(offset) is not int or not 1 <= limit <= 1000 or not 0 <= offset <= 1_000_000:
        raise ValueError("Use limit 1..1000 and offset 0..1000000")
    return rows[offset:offset + limit]


class SportsCatalog:
    def __init__(self, matches, manifest, team_rows=(), history=None, predictions=()):
        self.manifest = manifest
        self.as_of = utc_time(manifest["as_of"])
        self.matches = list(matches)
        self.history = None if history is None else list(history)
        self.predictions = {p["match_id"]: p for p in predictions}
        self.by_id = {r["match_id"]: r for r in self.matches}
        if len(self.by_id) != len(self.matches):
            raise ValueError("Canonical match IDs must be unique")
        self.gold_ids = {}
        for row in team_rows:
            if row.get("team_id"):
                self.gold_ids.setdefault((row["sport"], row["team_name"]), set()).add(row["team_id"])
        groups = {}
        for row in self.matches:
            if row["sport"] not in ("football", "valorant") or not isinstance(row.get("competition"), str):
                raise ValueError("Competition views require canonical sport and competition metadata")
            key = competition_id(row["sport"], row["competition"])
            groups.setdefault(key, []).append(row)
        self.groups = groups

    def identity(self, row, side):
        name = row[f"team_{side}"]
        ident = row.get(f"team_{side}_id")
        source = "match"
        if not ident:
            candidates = self.gold_ids.get((row["sport"], name), set())
            ident = next(iter(candidates)) if len(candidates) == 1 else None
            source = "gold_unique_name" if ident else "unresolved"
        return dict(team_id=ident, team_key=ident or f"unresolved:{row['sport']}:{name}",
                    team_name=name, identity_source=source)

    def team_side(self, row, team_key):
        a, b = self.identity(row, "a"), self.identity(row, "b")
        if a["team_key"] == b["team_key"]:
            # Identical unresolved display names cannot establish orientation.
            return None
        if a["team_key"] == team_key:
            return "a"
        if b["team_key"] == team_key:
            return "b"
        return None

    def match_row(self, row):
        a, b = self.identity(row, "a"), self.identity(row, "b")
        status = {"finished": "completed", "running": "running", "cancelled": "cancelled", "postponed": "postponed"}.get(row["status"])
        if row["status"] == "scheduled":
            status = "upcoming" if utc_time(row["start_time"]) > self.as_of else "overdue"
        return dict(row, competition_id=competition_id(row["sport"], row["competition"]),
                    snapshot_status=status, score_unit="goals" if row["sport"] == "football" else "maps",
                    team_a_id=a["team_id"], team_b_id=b["team_id"], team_a_key=a["team_key"], team_b_key=b["team_key"],
                    identity_source_a=a["identity_source"], identity_source_b=b["identity_source"])

    def participants(self, rows):
        result = {}
        ordered = sorted(rows, key=lambda r: (utc_time(r.get("observed_at") or self.manifest["as_of"]), r["match_id"]))
        for row in ordered:
            for side in ("a", "b"):
                identity = self.identity(row, side)
                result[identity["team_key"]] = identity
        return [result[k] for k in sorted(result)]

    def summary(self, ident):
        rows = self.groups.get(ident)
        if rows is None:
            raise KeyError("Unknown competition ID")
        states = [self.match_row(r)["snapshot_status"] for r in rows]
        counts = {status: states.count(status) for status in ("completed", "upcoming", "running", "overdue", "postponed", "cancelled")}
        if counts["running"] or counts["completed"] and counts["upcoming"]:
            status = "ongoing"
        elif counts["upcoming"]:
            status = "upcoming"
        elif counts["completed"] and not counts["overdue"] and not counts["postponed"]:
            status = "completed"
        else:
            status = "inactive"
        starts = [utc_time(r["start_time"]) for r in rows]
        availability = [utc_time(r["observed_at"]) for r in rows if r.get("observed_at")]
        sport = rows[0]["sport"]
        return dict(competition_id=ident, sport=sport, name=rows[0]["competition"], status=status,
            coverage_start=min(starts).date().isoformat(), coverage_end=max(starts).date().isoformat(),
            first_observed_at=min(availability).isoformat() if availability else None,
            last_observed_at=max(availability).isoformat() if availability else None,
            match_count=len(rows), completed_matches=counts["completed"], upcoming_matches=counts["upcoming"],
            running_matches=counts["running"], overdue_matches=counts["overdue"],
            cancelled_matches=counts["cancelled"], postponed_matches=counts["postponed"],
            participants=self.participants(rows), coverage_label=COVERAGE_LABEL, table_label=TABLE_LABEL,
            score_unit="goals" if sport == "football" else "maps",
            source_providers=sorted({r["provider"] for r in rows if r.get("provider")}))

    def competitions(self, sport=None, search=None, status=None, limit=100, offset=0):
        rows = [self.summary(ident) for ident in self.groups]
        if sport:
            rows = [r for r in rows if r["sport"] == sport]
        if search:
            rows = [r for r in rows if search.lower() in r["name"].lower()]
        if status:
            rows = [r for r in rows if r["status"] == status]
        rows = sorted(rows, key=lambda r: (r["coverage_start"], r["competition_id"]), reverse=True)
        return dict(rows=paginated(rows, limit, offset), total=len(rows), limit=limit, offset=offset,
                    contract_version=CONTRACT_VERSION, coverage_label=COVERAGE_LABEL)

    def fixtures(self, rows=None, sport=None, competition=None, status=None, team_name=None,
                 search=None, date_from=None, date_to=None, order="desc", limit=100, offset=0):
        begin, end = checked_dates(date_from, date_to)
        rows = list(self.matches if rows is None else rows)
        if sport:
            rows = [r for r in rows if r["sport"] == sport]
        if competition:
            rows = [r for r in rows if competition_id(r["sport"], r["competition"]) == competition]
        if status:
            rows = [r for r in rows if r["status"] == status]
        if team_name:
            rows = [r for r in rows if team_name.lower() in (r["team_a"].lower(), r["team_b"].lower())]
        if search:
            rows = [r for r in rows if search.lower() in " ".join(str(r.get(k, "")) for k in
                    ("team_a", "team_b", "competition", "match_id")).lower()]
        if begin:
            rows = [r for r in rows if utc_time(r["start_time"]).date() >= begin]
        if end:
            rows = [r for r in rows if utc_time(r["start_time"]).date() <= end]
        rows = ordered_matches(rows, order)
        page = [self.match_row(r) for r in paginated(rows, limit, offset)]
        groups = {}
        for row in page:
            groups.setdefault(utc_time(row["start_time"]).date().isoformat(), []).append(row)
        return dict(rows=page, date_groups=[dict(date=d, rows=values) for d, values in groups.items()],
                    total=len(rows), limit=limit, offset=offset, order=order, contract_version=CONTRACT_VERSION)

    def form_row(self, row, team_key):
        side = self.team_side(row, team_key)
        if side is None:
            raise ValueError("Cannot orient a result without a distinct team identity")
        other = "b" if side == "a" else "a"
        sf, sa = row[f"score_{side}"], row[f"score_{other}"]
        opponent = self.identity(row, other)
        return dict(match_id=row["match_id"], start_time=row["start_time"], completed_at=row["completed_at"],
            competition_id=competition_id(row["sport"], row["competition"]), competition=row["competition"],
            result="W" if sf > sa else "L" if sf < sa else "D", score_for=sf, score_against=sa,
            opponent_id=opponent["team_id"], opponent_name=opponent["team_name"])

    def table(self, ident):
        rows = self.groups.get(ident)
        if rows is None:
            raise KeyError("Unknown competition ID")
        completed = [r for r in rows if r["status"] == "finished"]
        result = []
        for team in self.participants(rows):
            played = [r for r in completed if self.team_side(r, team["team_key"]) is not None]
            form = [self.form_row(r, team["team_key"]) for r in ordered_matches(played)]
            wins, draws, losses = (sum(r["result"] == outcome for r in form) for outcome in ("W", "D", "L"))
            sf, sa = sum(r["score_for"] for r in form), sum(r["score_against"] for r in form)
            result.append(dict(team, played=len(form), wins=wins, draws=draws, losses=losses,
                score_for=sf, score_against=sa, score_difference=sf - sa,
                points=3 * wins + draws if rows[0]["sport"] == "football" else None,
                win_rate=wins / len(form) if form else 0.0, form=form[:5],
                last_match_at=max((r["completed_at"] for r in form), key=utc_time, default=None)))
        if rows[0]["sport"] == "football":
            result.sort(key=lambda r: (-r["points"], -r["score_difference"], -r["score_for"], r["team_key"]))
        else:
            result.sort(key=lambda r: (-r["wins"], -r["score_difference"], -r["win_rate"], r["team_key"]))
        return [dict(position=i + 1, **row) for i, row in enumerate(result)]

    def competition_detail(self, ident, **filters):
        summary = self.summary(ident)
        return dict(**self.fixtures(self.groups[ident], **filters), competition=summary,
                    participants=summary["participants"], table=self.table(ident), table_label=TABLE_LABEL)

    def known_results(self, target):
        cutoff = min(utc_time(target["start_time"]), self.as_of)
        source = self.history if self.history is not None else self.matches
        latest = {}
        for row in source:
            if row["sport"] != target["sport"] or row["match_id"] == target["match_id"] or not row.get("observed_at"):
                continue
            if utc_time(row["observed_at"]) > cutoff:
                continue
            old = latest.get(row["match_id"])
            if old is None or row.get("revision", 0) > old.get("revision", 0):
                latest[row["match_id"]] = row
        rows = [r for r in latest.values() if r["status"] == "finished" and r.get("completed_at")
                and utc_time(r["completed_at"]) < cutoff and utc_time(r["start_time"]) < cutoff]
        return cutoff, ordered_matches(rows)

    def match_detail(self, ident):
        target = self.by_id.get(ident)
        if target is None:
            raise KeyError("Unknown match ID")
        cutoff, results = self.known_results(target)
        a, b = self.identity(target, "a"), self.identity(target, "b")

        def recent(team):
            eligible = [r for r in results if self.team_side(r, team["team_key"]) is not None]
            form = [self.form_row(r, team["team_key"]) for r in eligible[:5]]
            return dict(team, played=len(form), wins=sum(r["result"] == "W" for r in form),
                draws=sum(r["result"] == "D" for r in form), losses=sum(r["result"] == "L" for r in form),
                score_for=sum(r["score_for"] for r in form), score_against=sum(r["score_against"] for r in form), rows=form)

        pair = {a["team_key"], b["team_key"]}
        h2h = [r for r in results if len(pair) == 2 and
               {self.identity(r, "a")["team_key"], self.identity(r, "b")["team_key"]} == pair]
        oriented = [self.form_row(r, a["team_key"]) for r in h2h]
        basis = "observation_history" if self.history is not None else "current_rows_only"
        row = self.match_row(target)
        return dict(rows=[row], match=row, competition=self.summary(row["competition_id"]),
            cutoff=cutoff.isoformat(), history_basis=basis,
            history_label="Highest observed revision known by cutoff" if self.history is not None else
                          "Current snapshot rows known by cutoff; earlier corrected versions may be missing",
            form_scope="all_observed_competitions", form_a=recent(a), form_b=recent(b),
            head_to_head=dict(total=len(h2h), team_a_wins=sum(r["result"] == "W" for r in oriented),
                draws=sum(r["result"] == "D" for r in oriented), team_b_wins=sum(r["result"] == "L" for r in oriented),
                rows=[self.match_row(r) for r in h2h[:10]]), prediction=self.predictions.get(ident),
            provenance=dict(providers=sorted({r["provider"] for r in [target] + results if r.get("provider")}),
                data_kind=self.manifest["data_kind"], as_of=self.manifest["as_of"], coverage_label=COVERAGE_LABEL),
            contract_version=CONTRACT_VERSION)
