"""Read a bounded, checksum-verified CC0 research package without inferred clocks.

This independent contract complements the canonical instant-based snapshot. It
never promotes a source calendar date to a UTC kickoff or a historical forecast.
"""

import hashlib
import json
import re
import unicodedata
from collections import Counter
from functools import lru_cache
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path, PurePosixPath

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

VERSION = "openfootball-research-1.0"
VERSION_V2 = "openfootball-research-2.0"
SUPPORTED_VERSIONS = (VERSION, VERSION_V2)
WORLD_CUP_SHA256 = "0ae2c18109b5aa86bc11928b43586ca430c234804d5bbf808d2c3bf2051ecfca"
LICENSE_URL = "https://github.com/openfootball/football.json/blob/master/LICENSE.md"
RAW_PREFIX = "https://raw.githubusercontent.com/openfootball/football.json/"
FILES = {"gold/matches.parquet", "gold/match_history.parquet", "matches.json", "history.json",
         "sources.json", "competitions.json", "quality.json", "lineage.json", "quarantine.json", "polls.json"}
CONTENT = ("as_of", "matches", "history", "sources", "competitions", "quality", "lineage", "quarantine", "polls")
MAX_MATCHES = 25_000
MAX_HISTORY = 50_000
MAX_BYTES = 128_000_000
ROW_FIELDS = ("staging_version", "provider", "sport", "source_id", "competition_id", "competition",
    "season", "round", "occurrence", "match_id", "team_a_id", "team_a", "team_b_id", "team_b",
    "team_namespace", "team_identity_status", "source_date", "local_time", "timezone", "kickoff_precision",
    "start_time", "completed_at", "result_status", "score_a", "score_b", "score_details_json", "score_basis",
    "prediction_eligible", "observed_at", "source_url", "source_sha256", "source_ref", "license", "license_url",
    "availability_basis", "identity_basis", "quality_score", "revision", "event_id", "edition_id")
GOLD_SCHEMA = pa.schema([(field, pa.int64() if field in ("score_a", "score_b", "revision", "occurrence")
                        else pa.float64() if field == "quality_score" else pa.bool_() if field == "prediction_eligible"
                        else pa.string()) for field in ROW_FIELDS])
ROW_FIELDS_V2 = ROW_FIELDS[:-1] + ("team_type", "source_match_number", "source_group", "ground",
                                  "utc_offset_minutes", "edition_id")
GOLD_SCHEMA_V2 = pa.schema([(field, pa.int64() if field in ("score_a", "score_b", "revision", "occurrence",
                            "source_match_number", "utc_offset_minutes") else pa.float64() if field == "quality_score"
                            else pa.bool_() if field == "prediction_eligible" else pa.string()) for field in ROW_FIELDS_V2])


def gold_schema(version):
    return GOLD_SCHEMA_V2 if version == VERSION_V2 else GOLD_SCHEMA


@lru_cache(maxsize=1)
def worldcup_anchors():
    """Bind the fixed national edition to reviewed, byte-preserved source facts."""
    body = (Path(__file__).parent / "resources/worldcup_2026.json").read_bytes()
    if digest(body) != WORLD_CUP_SHA256:
        raise ResearchError("Packaged World Cup reference bytes have changed")
    raw = json.loads(body.decode("utf-8"), object_pairs_hook=_object)
    if raw.get("name") != "World Cup 2026" or len(raw.get("matches", [])) != 104:
        raise ResearchError("Packaged World Cup reference scope has changed")
    anchors = {}
    for match in raw["matches"]:
        a, b = match["team1"], match["team2"]
        a_id = "openfootball:team:" + digest(["openfootball-national-men", a])[:24]
        b_id = "openfootball:team:" + digest(["openfootball-national-men", b])[:24]
        number = match.get("num")
        identity = (["worldcup", "2026", number] if number is not None else
                    ["worldcup", "2026", match["round"], a_id, b_id, 1])
        ident = "openfootball:match:" + digest(identity)[:24]
        clock = re.fullmatch(r"((?:[01]\d|2[0-3]):[0-5]\d) UTC([+-])(\d{1,2})(?::([0-5]\d))?", match["time"])
        if not clock:
            raise ResearchError("Packaged World Cup numeric clock is invalid")
        offset = (int(clock[3]) * 60 + int(clock[4] or 0)) * (1 if clock[2] == "+" else -1)
        anchors[ident] = dict(team_a=a, team_b=b, team_a_id=a_id, team_b_id=b_id, round=match["round"],
            occurrence=1, source_date=match["date"], local_time=clock[1], utc_offset_minutes=offset,
            source_match_number=number, source_group=match.get("group"), ground=match.get("ground"),
            score_details_json=canonical(match.get("score", {})))
    if len(anchors) != 104:
        raise ResearchError("Packaged World Cup identities collide")
    return anchors


class ResearchError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value).encode("utf-8")).hexdigest()


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ResearchError("Duplicate JSON key")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ResearchError("Nonfinite JSON value")))


def utc(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ResearchError("Observation timestamp must be an aware UTC instant")
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None or instant.utcoffset().total_seconds() != 0:
        raise ResearchError("Observation timestamp must be an aware UTC instant")
    return instant.astimezone(timezone.utc)


def text(value):
    if (not isinstance(value, str) or not value.strip() or len(value) > 200
            or value != unicodedata.normalize("NFC", value.strip())
            or any(unicodedata.category(c).startswith("C") for c in value)):
        raise ResearchError("Invalid source display text")
    return value


def _source(row, catalogue, version=VERSION):
    expected = catalogue.get(row["source_id"])
    if not expected or any(row.get(field) != expected[field] for field in
                           ("competition_id", "season", "path", "name", "region", "team_namespace")):
        raise ResearchError("Source is outside the reviewed OpenFootball catalogue")
    for field in ("source_id", "competition_id", "team_namespace"):
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", row[field]):
            raise ResearchError("Invalid source identity")
    if not re.fullmatch(r"\d{4}(?:-\d{2})?", row["season"]):
        raise ResearchError("Invalid source season")
    if not re.fullmatch(re.escape(row["season"]) + r"/[a-z0-9.-]+\.json", row["path"]):
        raise ResearchError("Unsafe source path")
    if not re.fullmatch(r"master|[a-f0-9]{40}", row.get("source_ref", "master")):
        raise ResearchError("Unsafe source ref")
    for field in ("name", "region"):
        text(row[field])
    repository = row.get("repository", "football.json")
    if version == VERSION_V2:
        if (repository != expected.get("repository", "football.json")
                or row.get("team_type") != expected.get("team_type", "club")):
            raise ResearchError("Repository or team type differs from the reviewed catalogue")
        if repository == "worldcup.json" and row.get("source_ref") != expected["source_ref"]:
            raise ResearchError("World Cup source must use the reviewed pinned commit")
    elif repository != "football.json" or expected.get("team_type", "club") != "club":
        raise ResearchError("National source requires the v2 research contract")
    aliases = row.get("team_aliases") or {}
    if not isinstance(aliases, dict):
        raise ResearchError("Invalid reviewed alias mapping")
    for original, target in aliases.items():
        for value in (original, target):
            if (not isinstance(value, str) or len(value) > 200
                    or any(unicodedata.category(c).startswith("C") for c in value)):
                raise ResearchError("Invalid reviewed alias text")
            text(unicodedata.normalize("NFC", value.strip()))


def _row(row, sources, as_of, version=VERSION):
    source = sources.get(row["source_id"])
    if not source or row["edition_id"] != row["source_id"]:
        raise ResearchError("Unknown research source or edition")
    repository = source.get("repository", "football.json")
    reference = source.get("source_ref", "master")
    license_url = (f"https://github.com/openfootball/{repository}/blob/{reference}/LICENSE.md"
                   if version == VERSION_V2 else LICENSE_URL)
    for field, expected in {
        "staging_version": "openfootball-staging-2.0" if version == VERSION_V2 else "openfootball-staging-1.0",
        "sport": "football", "provider": "openfootball",
        "competition_id": source["competition_id"], "competition": source["name"], "season": source["season"],
        "team_namespace": source["team_namespace"], "license": "CC0-1.0", "license_url": license_url,
        "availability_basis": "first_collected_revision", "source_ref": source.get("source_ref", "master"),
    }.items():
        if row[field] != expected:
            raise ResearchError(f"Research row provenance mismatch: {field}")
    if row["source_url"] != f"https://raw.githubusercontent.com/openfootball/{repository}/{reference}/{source['path']}":
        raise ResearchError("Source URL is outside the fixed CC0 repository")
    if not re.fullmatch(r"[a-f0-9]{64}", row["source_sha256"]):
        raise ResearchError("Invalid raw source checksum")
    if repository == "worldcup.json" and row["source_sha256"] != WORLD_CUP_SHA256:
        raise ResearchError("World Cup row is not from the reviewed pinned source bytes")
    if row["team_identity_status"] not in ("unresolved_name_derived_not_official", "derived_reviewable_not_official"):
        raise ResearchError("OpenFootball names cannot claim official team identity")
    if (any(row[field] is not None for field in ("timezone", "completed_at"))
            or row["prediction_eligible"] is not False):
        raise ResearchError("Unresolved source clocks cannot enter forecasting")
    day = row["source_date"]
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ResearchError("Invalid source calendar date")
    date.fromisoformat(day)
    wall = row["local_time"]
    if wall is not None and (not isinstance(wall, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", wall)):
        raise ResearchError("Invalid source local wall time")
    offset = row.get("utc_offset_minutes") if version == VERSION_V2 else None
    if offset is not None:
        if (repository != "worldcup.json" or type(offset) is not int or not -840 <= offset <= 840 or wall is None):
            raise ResearchError("Numeric source offset is invalid or outside its reviewed source")
        derived = datetime.combine(date.fromisoformat(day), time.fromisoformat(wall),
                                   timezone(timedelta(minutes=offset))).astimezone(timezone.utc)
        if row["start_time"] != derived.isoformat(timespec="microseconds").replace("+00:00", "Z"):
            raise ResearchError("UTC kickoff differs from the explicit source date/clock/offset")
    elif row["start_time"] is not None:
        raise ResearchError("An unqualified source clock cannot assert a UTC kickoff")
    if row["kickoff_precision"] != ("offset_minute" if offset is not None else "local_minute" if wall else "date_only"):
        raise ResearchError("Date precision disagrees with source clock")
    if version == VERSION_V2:
        if row["team_type"] != source["team_type"]:
            raise ResearchError("Team type disagrees with its reviewed source")
        number = row["source_match_number"]
        if number is not None and (repository != "worldcup.json" or type(number) is not int or not 1 <= number <= 10_000):
            raise ResearchError("Source match number is invalid or outside a national edition")
        for field in ("source_group", "ground"):
            if row[field] is not None:
                text(row[field])
    observed = utc(row["observed_at"])
    if observed > as_of:
        raise ResearchError("Revision was observed after package cutoff")
    for field in ("revision", "occurrence"):
        if type(row[field]) is not int or not 1 <= row[field] <= (100 if field == "occurrence" else 100_000):
            raise ResearchError("Invalid revision or occurrence")
    for field in ("round", "team_a", "team_b"):
        text(row[field])
    aliases = source.get("team_aliases") or {}
    for side in ("a", "b"):
        name = row[f"team_{side}"]
        identity_name = unicodedata.normalize("NFC", aliases.get(name, name).strip())
        expected = "openfootball:team:" + digest([source["team_namespace"], identity_name])[:24]
        if row[f"team_{side}_id"] != expected:
            raise ResearchError("Name-derived team identity is inconsistent")
    if row["team_a_id"] == row["team_b_id"]:
        raise ResearchError("A team cannot play itself")
    numbered = version == VERSION_V2 and row["source_match_number"] is not None
    identity = ([row["competition_id"], row["season"], row["source_match_number"]] if numbered else
                [row["competition_id"], row["season"], row["round"], row["team_a_id"], row["team_b_id"], row["occurrence"]])
    basis = "competition-season-source-match-number" if numbered else "competition-season-round-ordered-teams-occurrence"
    expected = "openfootball:match:" + digest(identity)[:24]
    if row["identity_basis"] != basis:
        raise ResearchError("Match identity basis disagrees with its source number")
    if row["match_id"] != expected:
        raise ResearchError("Stable match identity is inconsistent")
    if repository == "worldcup.json":
        anchor = worldcup_anchors().get(row["match_id"])
        if anchor is None or any(row[field] != expected for field, expected in anchor.items()):
            raise ResearchError("World Cup facts differ from the reviewed immutable source body")
    details = json.loads(row["score_details_json"], object_pairs_hook=_object)
    if not isinstance(details, dict) or not set(details) <= {"ft", "ht", "et", "p"}:
        raise ResearchError("Unsupported source score shape")
    for pair in details.values():
        if not isinstance(pair, list) or len(pair) != 2 or any(type(n) is not int or not 0 <= n <= 50 for n in pair):
            raise ResearchError("Invalid source score pair")
    pair = details.get("ft", [None, None])
    scores = (row["score_a"], row["score_b"])
    if [row["score_a"], row["score_b"]] != pair or any(n is not None and type(n) is not int for n in scores):
        raise ResearchError("Score values disagree with source ft evidence")
    scored = "ft" in details
    if (row["result_status"] != ("observed_result" if scored else "unknown_result")
            or row["score_basis"] != ("source_ft_unverified_regulation" if scored else "unknown")):
        raise ResearchError("Result availability or basis is inconsistent")
    if type(row["quality_score"]) not in (int, float) or row["quality_score"] != 1.0:
        raise ResearchError("Unexpected staging validation score")
    excluded = {"edition_id", "revision", "event_id", "observed_at", "source_sha256", "source_url", "license", "license_url"}
    business = {k: v for k, v in row.items() if k not in excluded}
    if row["event_id"] != f"{row['match_id']}:{row['revision']}:{digest(business)[:16]}":
        raise ResearchError("Revision event identity is inconsistent")


def validate_research(root):
    try:
        root = Path(root)
        if root.is_symlink():
            raise ResearchError("Research root symlinks are forbidden")
        root = root.resolve(strict=True)
        manifest_path = root / "manifest.json"
        if manifest_path.is_symlink() or manifest_path.stat().st_size > 1_000_000:
            raise ResearchError("Unsafe research manifest")
        manifest = read_json(manifest_path)
        version = manifest["research_version"]
        if (version not in SUPPORTED_VERSIONS or manifest["data_kind"] != "open_data"
                or manifest["provider"] != "openfootball" or manifest["license"] != "CC0-1.0"
                or manifest["canonical_compatible"] is not False):
            raise ResearchError("Unsupported research or license contract")
        as_of = utc(manifest["as_of"])
        if utc(manifest["generated_at"]) < as_of:
            raise ResearchError("Publication precedes observation cutoff")
        for name in ("dataset_version", "upstream_staging_fingerprint"):
            if not re.fullmatch(r"[a-f0-9]{" + ("16" if name == "dataset_version" else "64") + r"}", manifest[name]):
                raise ResearchError("Malformed dataset identity")
        files = manifest["files"]
        if set(files) != FILES:
            raise ResearchError("Required research files are missing or unexpected")
        actual, total = set(), 0
        for item in root.rglob("*"):
            if item.is_symlink():
                raise ResearchError("Research package symlinks are forbidden")
            if item.is_file() and item != manifest_path:
                actual.add(item.relative_to(root).as_posix())
        if actual != FILES:
            raise ResearchError("Research package has missing or extra files")
        for name, expected in files.items():
            pure = PurePosixPath(name)
            if (pure.is_absolute() or ".." in pure.parts or "\\" in name or ":" in name
                    or str(pure) != name or not re.fullmatch(r"[a-f0-9]{64}", expected)):
                raise ResearchError("Unsafe research path or checksum")
            item = root.joinpath(*pure.parts)
            if not item.resolve().is_relative_to(root):
                raise ResearchError("Research path escapes its package")
            total += item.stat().st_size
            if total > MAX_BYTES:
                raise ResearchError("Research package exceeds local size limit")
            if digest(item.read_bytes()) != expected:
                raise ResearchError(f"Checksum mismatch: {name}")
        payload = {name: read_json(root / f"{name}.json") for name in CONTENT if name != "as_of"}
        payload["as_of"] = manifest["as_of"]
        if digest(payload)[:16] != manifest["dataset_version"]:
            raise ResearchError("Dataset content identity mismatch")
        if (not isinstance(payload["matches"], list) or len(payload["matches"]) > MAX_MATCHES
                or not isinstance(payload["history"], list) or len(payload["history"]) > MAX_HISTORY
                or not isinstance(payload["sources"], list)
                or not 1 <= len(payload["sources"]) <= (10 if version == VERSION_V2 else 9)):
            raise ResearchError("Research row limits exceeded")
        sources = {}
        scopes = set()
        catalogue = {r["source_id"]: r for r in read_json(Path(__file__).parent / "resources/openfootball_sources.json")["sources"]}
        for source in payload["sources"]:
            _source(source, catalogue, version)
            if source["source_id"] in sources or (source["competition_id"], source["season"]) in scopes:
                raise ResearchError("Duplicate source scope")
            sources[source["source_id"]] = source
            scopes.add((source["competition_id"], source["season"]))
        for key, bound, table in (("matches", MAX_MATCHES, "matches"), ("history", MAX_HISTORY, "match_history")):
            path = root / f"gold/{table}.parquet"
            parquet = pq.ParquetFile(path)
            if parquet.metadata.num_rows > bound or not parquet.schema_arrow.equals(gold_schema(version)):
                raise ResearchError("Parquet schema or row limit is invalid")
            rows = pq.read_table(path).to_pylist()
            if canonical(rows) != canonical(payload[key]):
                raise ResearchError("Research JSON and Gold Parquet disagree")
            for row in rows:
                _row(row, sources, as_of, version)
        current = {}
        for row in payload["matches"]:
            if row["match_id"] in current:
                raise ResearchError("Duplicate current match identity")
            current[row["match_id"]] = row
        for source in sources.values():
            if source.get("repository") == "worldcup.json":
                imported = {r["match_id"] for r in payload["matches"] if r["source_id"] == source["source_id"]}
                if imported != set(worldcup_anchors()):
                    raise ResearchError("Pinned World Cup current coverage must contain its complete reviewed body")
        histories = {}
        for row in payload["history"]:
            histories.setdefault(row["match_id"], []).append(row)
        if set(histories) != set(current):
            raise ResearchError("Current/history scope mismatch")
        for ident, rows in histories.items():
            ordered = sorted(rows, key=lambda r: r["revision"])
            if [r["revision"] for r in ordered] != list(range(1, len(ordered) + 1)):
                raise ResearchError("History revisions are incomplete or duplicated")
            if (ordered[-1] != current[ident] or any(a["source_id"] != b["source_id"]
                    or utc(a["observed_at"]) > utc(b["observed_at"])
                    or a["event_id"].rsplit(":", 1)[-1] == b["event_id"].rsplit(":", 1)[-1]
                    for a, b in zip(ordered, ordered[1:]))):
                raise ResearchError("Current/history latest observation mismatch")
        for key, rows in (("matches", payload["matches"]), ("revisions", payload["history"]),
                          ("sources", payload["sources"]), ("quarantine_rows", payload["quarantine"])):
            if type(manifest[key]) is not int or manifest[key] != len(rows):
                raise ResearchError("Manifest measured counts disagree")
        if not isinstance(payload["quality"], dict) or not isinstance(payload["lineage"], list):
            raise ResearchError("Invalid quality or lineage evidence")
        _verify_observations(payload, sources, as_of, version)
        _verify_competitions(payload, sources, version)
        fingerprint = digest({"research_version": version, "files": files,
                              "upstream_staging_fingerprint": manifest["upstream_staging_fingerprint"]})
        return dict(manifest=manifest, snapshot_fingerprint=fingerprint, **{k: v for k, v in payload.items() if k != "as_of"})
    except ResearchError:
        raise
    except (KeyError, ValueError, TypeError, OSError, RecursionError) as error:
        raise ResearchError("Malformed OpenFootball research package") from error


def _verify_competitions(payload, sources, version=VERSION):
    editions = payload["competitions"]
    if not isinstance(editions, list) or {e["edition_id"] for e in editions} != set(sources) or len(editions) != len(sources):
        raise ResearchError("Competition directory does not match source scope")
    for edition in editions:
        source = sources[edition["edition_id"]]
        rows = [r for r in payload["matches"] if r["source_id"] == edition["edition_id"]]
        observed_rows = sorted(rows, key=lambda r: (utc(r["observed_at"]), r["match_id"]))
        teams = {r[f"team_{side}_id"]: r[f"team_{side}"] for r in observed_rows for side in ("a", "b")}
        expected = dict(edition_id=source["source_id"], competition_id=source["competition_id"], name=source["name"],
            season=source["season"], region=source["region"],
            coverage_start=min((r["source_date"] for r in rows), default=None),
            coverage_end=max((r["source_date"] for r in rows), default=None), match_count=len(rows),
            observed_results=sum(r["result_status"] == "observed_result" for r in rows),
            unknown_results=sum(r["result_status"] == "unknown_result" for r in rows),
            date_only=sum(r["kickoff_precision"] == "date_only" for r in rows),
            local_minute=sum(r["kickoff_precision"] == "local_minute" for r in rows),
            participants=[dict(team_id=k, team_name=teams[k]) for k in sorted(teams)])
        if version == VERSION_V2:
            expected.update(team_type=source["team_type"],
                            offset_minute=sum(r["kickoff_precision"] == "offset_minute" for r in rows))
        if edition != expected:
            raise ResearchError("Competition summary disagrees with observed rows")


def _verify_observations(payload, sources, as_of, version=VERSION):
    polls, history, rows, problems = payload["polls"], payload["history"], payload["matches"], payload["quarantine"]
    if not isinstance(polls, list) or not 1 <= len(polls) <= 100_000 or not isinstance(problems, list):
        raise ResearchError("Invalid or unbounded source poll evidence")
    audit = Counter()
    poll_ids, poll_sources, times = set(), set(), []
    rejected, archives, previous = Counter(), set(), {}
    if any(not isinstance(p, dict) or type(p.get("poll_id")) is not int for p in polls):
        raise ResearchError("Invalid poll audit record")
    ordered_polls = sorted(polls, key=lambda p: p["poll_id"])
    for poll in ordered_polls:
        if (set(poll) != {"poll_id", "source_id", "observed_at", "status", "sha256", "changed", "quarantined"}
                or poll["source_id"] not in sources or type(poll["poll_id"]) is not int or poll["poll_id"] < 1
                or poll["poll_id"] in poll_ids or poll["status"] not in ("collected", "not_modified")
                or not re.fullmatch(r"[a-f0-9]{64}", poll["sha256"])):
            raise ResearchError("Invalid source poll identity or provenance")
        for field in ("changed", "quarantined"):
            if type(poll[field]) is not int or not 0 <= poll[field] <= 10_000:
                raise ResearchError("Invalid source poll measured counts")
        if (sources[poll["source_id"]].get("repository") == "worldcup.json"
                and poll["sha256"] != WORLD_CUP_SHA256):
            raise ResearchError("World Cup poll differs from the reviewed pinned archive")
        if poll["status"] == "not_modified" and (poll["changed"] or poll["quarantined"]):
            raise ResearchError("A 304 poll cannot create revisions or quarantine")
        instant = utc(poll["observed_at"])
        if poll["source_id"] in previous and instant < previous[poll["source_id"]]:
            raise ResearchError("Source poll observations move backwards")
        previous[poll["source_id"]] = instant
        archive = (poll["source_id"], poll["sha256"])
        if poll["status"] == "not_modified" and archive not in archives:
            raise ResearchError("A 304 poll has no previously collected archive checksum")
        if poll["status"] == "collected":
            archives.add(archive)
        times.append(instant)
        audit[(poll["source_id"], poll["observed_at"], poll["sha256"])] += poll["changed"]
        rejected[(poll["source_id"], poll["observed_at"], poll["sha256"])] += poll["quarantined"]
        poll_ids.add(poll["poll_id"])
        poll_sources.add(poll["source_id"])
    actual = Counter((r["source_id"], r["observed_at"], r["source_sha256"]) for r in history)
    if poll_sources != set(sources) or max(times) != as_of or actual != +audit:
        raise ResearchError("Revision observation has no matching source poll evidence")
    if len(problems) > 100_000:
        raise ResearchError("Quarantine evidence exceeds row limit")
    problem_counts, problem_ids = Counter(), set()
    for problem in problems:
        if (not isinstance(problem, dict) or set(problem) !=
                {"source_id", "sha256", "row_index", "reason", "observed_at", "raw_json"}
                or problem["source_id"] not in sources or type(problem["row_index"]) is not int
                or not -1 <= problem["row_index"] <= 9999 or not isinstance(problem["reason"], str)
                or not 0 < len(problem["reason"]) <= 2000 or not isinstance(problem["raw_json"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", problem["sha256"])):
            raise ResearchError("Invalid quarantine evidence fields")
        key = (problem["source_id"], problem["observed_at"], problem["sha256"])
        ident = (problem["source_id"], problem["sha256"], problem["row_index"], problem["reason"])
        if key not in rejected or rejected[key] <= 0 or ident in problem_ids or utc(problem["observed_at"]) > as_of:
            raise ResearchError("Quarantine lacks source poll evidence")
        json.loads(problem["raw_json"], object_pairs_hook=_object,
                   parse_constant=lambda _: (_ for _ in ()).throw(ResearchError("Nonfinite quarantine JSON")))
        problem_ids.add(ident)
        problem_counts[key] += 1
    if any(count > rejected[key] for key, count in problem_counts.items()):
        raise ResearchError("Quarantine evidence exceeds measured source poll rejection counts")
    team_ids = {r[f"team_{side}_id"] for r in rows for side in ("a", "b")}
    expected = dict(match_count=len(rows), revision_count=len(history), source_count=len(sources),
        observed_results=sum(r["result_status"] == "observed_result" for r in rows),
        unknown_results=sum(r["result_status"] == "unknown_result" for r in rows),
        date_only=sum(r["kickoff_precision"] == "date_only" for r in rows),
        local_minute=sum(r["kickoff_precision"] == "local_minute" for r in rows),
        unresolved_timezones=len(rows), unresolved_team_identities=len(team_ids), prediction_ineligible=len(rows),
        quarantine_rows=len(problems))
    if version == VERSION_V2:
        expected["offset_minute"] = sum(r["kickoff_precision"] == "offset_minute" for r in rows)
        expected["unresolved_timezones"] = sum(r["utc_offset_minutes"] is None for r in rows)
    for field, value in expected.items():
        if type(payload["quality"].get(field)) is not int or payload["quality"][field] != value:
            raise ResearchError("Quality measured counts disagree with research rows")


def default_research():
    return Path(__file__).parent / "research_fixture"


class OpenFootballResearch:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.payload = validate_research(self.root)
        self.manifest = self.payload["manifest"]
        self.fingerprint = self.payload["snapshot_fingerprint"]
        self.table = pa.Table.from_pylist(self.payload["matches"], schema=gold_schema(self.manifest["research_version"]))
        self.matches_by_id = {r["match_id"]: r for r in self.payload["matches"]}
        self.editions = {r["edition_id"]: r for r in self.payload["competitions"]}
        self.team_profiles = self._team_profiles()
        self.payload["teams"] = [{k: v for k, v in p.items()
                                 if k not in {"editions", "recent_match_ids", "recent_match_limit", "coverage_note"}}
                                 for p in self.team_profiles.values()]
        self.payload["team_profiles"] = list(self.team_profiles.values())

    def envelope(self, rows, **extra):
        return dict(contract_version=self.manifest["research_version"], dataset_version=self.manifest["dataset_version"],
            snapshot_fingerprint=self.fingerprint, as_of=self.manifest["as_of"], data_kind="open_data",
            provider="openfootball", license="CC0-1.0", precision_note=self.manifest["precision_note"],
            coverage_note=self.manifest["coverage_note"], rows=rows, **extra)

    def snapshot(self):
        return self.payload

    def _team_profiles(self):
        appearances, identities = {}, {}
        for row in sorted(self.payload["matches"], key=lambda r: (r["observed_at"], r["match_id"])):
            for side in ("a", "b"):
                ident = row[f"team_{side}_id"]
                appearances.setdefault(ident, []).append(row)
                identities[ident] = (row[f"team_{side}"], row["team_namespace"], row.get("team_type", "club"))
        profiles = {}
        for ident, (name, namespace, team_type) in sorted(identities.items(), key=lambda item: (item[1][0].casefold(), item[0])):
            rows = appearances[ident]
            edition_ids = sorted({r["edition_id"] for r in rows})
            editions = []
            for edition_id in edition_ids:
                covered = [r for r in rows if r["edition_id"] == edition_id]
                edition = self.editions[edition_id]
                observed = sum(r["result_status"] == "observed_result" for r in covered)
                editions.append(dict(edition_id=edition_id, name=edition["name"], season=edition["season"],
                    record_count=len(covered), observed_results=observed, unknown_results=len(covered) - observed))
            recent = sorted(rows, key=lambda r: (-date.fromisoformat(r["source_date"]).toordinal(),
                                                r["local_time"] or "", r["match_id"]))[:25]
            observed = sum(r["result_status"] == "observed_result" for r in rows)
            regions = sorted({self.editions[e]["region"] for e in edition_ids})
            profiles[ident] = dict(team_id=ident, team_name=name, team_namespace=namespace, team_type=team_type,
                region=regions[0] if len(regions) == 1 else "Multiple regions", record_count=len(rows),
                observed_results=observed, unknown_results=len(rows) - observed, edition_ids=edition_ids,
                latest_source_date=max(r["source_date"] for r in rows), editions=editions,
                recent_match_ids=[r["match_id"] for r in recent], recent_match_limit=25,
                coverage_note="Counts describe imported source records, not complete team history or official performance.")
        return profiles

    def teams(self, search=None, team_type=None, limit=100, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or not 0 <= offset <= 100_000:
            raise ResearchError("Invalid team pagination")
        if team_type not in (None, "club", "national"):
            raise ResearchError("Invalid team type")
        rows = [row for row in self.payload["teams"]
                if (not search or search.casefold() in row["team_name"].casefold())
                and (not team_type or row["team_type"] == team_type)]
        return self.envelope(rows[offset:offset + limit], total=len(rows), limit=limit, offset=offset)

    def team(self, ident, **filters):
        if ident not in self.team_profiles:
            raise KeyError("Unknown source-derived OpenFootball team")
        result = self.matches(team_id=ident, **filters)
        result["team"] = self.team_profiles[ident]
        return result

    def competitions(self, *, search=None, region=None, limit=100, offset=0):
        rows = [r for r in self.payload["competitions"] if (not region or r["region"] == region)
                and (not search or search.casefold() in (r["name"] + " " + r["season"]).casefold())]
        return self.envelope(rows[offset:offset + limit], total=len(rows), limit=limit, offset=offset)

    def matches(self, *, edition_id=None, team_id=None, search=None, result_status=None, source_group=None, round=None,
                date_from=None, date_to=None, order="desc", limit=25, offset=0):
        if order not in ("asc", "desc"):
            raise ResearchError("Invalid source-date order")
        if date_from and date_to and date.fromisoformat(str(date_from)) > date.fromisoformat(str(date_to)):
            raise ResearchError("Source date range is reversed")
        clauses, values = [], []
        for field, value in (("edition_id", edition_id), ("result_status", result_status)):
            if value:
                clauses.append(f"{field} = ?")
                values.append(value)
        for field, value in (("source_group", source_group), ("round", round)):
            if value:
                if field not in self.table.column_names:
                    clauses.append("FALSE")
                else:
                    clauses.append(f"{field} = ?")
                    values.append(value)
        if team_id:
            clauses.append("(team_a_id = ? OR team_b_id = ?)")
            values.extend([team_id, team_id])
        if search:
            group = "coalesce(source_group, '')" if "source_group" in self.table.column_names else "''"
            clauses.append("contains(lower(team_a || ' ' || team_b || ' ' || competition || ' ' || season || ' ' || "
                           f"coalesce(round, '') || ' ' || {group} || ' ' || match_id), lower(?))")
            values.append(search)
        for operator, day in ((">=", date_from), ("<=", date_to)):
            if day:
                date.fromisoformat(str(day))
                clauses.append(f"source_date {operator} ?")
                values.append(str(day))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with duckdb.connect(":memory:") as db:
            db.register("verified_matches", self.table)
            total = db.execute(f"SELECT COUNT(*) FROM verified_matches {where}", values).fetchone()[0]
            result = db.execute(f"SELECT * FROM verified_matches {where} ORDER BY source_date {order.upper()},"
                                "coalesce(local_time, '') ASC,match_id ASC "
                                "LIMIT ? OFFSET ?", values + [limit, offset])
            columns = [c[0] for c in result.description]
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
        return self.envelope(rows, total=total, limit=limit, offset=offset, order=order, date_basis="source_calendar_date")

    def match(self, ident):
        if ident not in self.matches_by_id:
            raise KeyError("Unknown OpenFootball match")
        row = self.matches_by_id[ident]
        revisions = [r for r in self.payload["history"] if r["match_id"] == ident]
        return self.envelope([row], match=row, revisions=revisions, competition=self.editions[row["edition_id"]],
            forecast_status="unavailable_unresolved_time_and_target", history_basis="retrospective_source_observations")

    def competition(self, ident, **filters):
        if ident not in self.editions:
            raise KeyError("Unknown OpenFootball competition edition")
        result = self.matches(edition_id=ident, **filters)
        result["competition"] = self.editions[ident]
        return result


def write_public_research(root, output):
    research = OpenFootballResearch(root)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical(research.snapshot()) + "\n", encoding="utf-8", newline="\n")
    return research.snapshot()
