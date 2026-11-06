"""Bounded v2 current-directory projection and independent wire validation.

Only verified immutable captures enter the projector. Public validation requires
no private packages, provider runtime, acquisition, or model context.
"""

import json
import re
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import Field, field_validator

from .current_publication import PENDING
from .live_publication import (
    ATTRIBUTION, ERROR_CODES, FILES, LICENSE_NOTE, MAX_CARDS, MAX_FILE_BYTES, PROVIDERS,
    CanonicalIdentity, Coverage, Credit, DisplayError, DisplayID, Health, Hex16, Hex64,
    Provider, Stamp, Strict, TeamCard, _canonical, _card, _clock, _hash, _identity, _stamp,
)
from .snapshot import utc_time

SCHEMA = "arena-live-display-2.0"
MAX_NODES = 1500
Day = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Label = Annotated[str, Field(min_length=1, max_length=120)]
Name = Annotated[str, Field(min_length=1, max_length=240)]
Count = Annotated[int, Field(ge=0, le=100_000)]
KINDS = ("competition", "league", "series", "tournament")
SOURCE_STATUS = {"not_started": "Scheduled", "running": "In progress", "finished": "Finished",
                 "canceled": "Cancelled", "postponed": "Postponed"}


def _clean(value):
    if value is not None and any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Invalid display text")
    return value


def _text(value, bound=120):
    if value is None:
        return None
    cleaned = "".join(" " if ord(char) < 32 or ord(char) == 127 else char for char in value).strip()
    return cleaned[:bound] or None


class CalendarIdentity(Strict):
    dataset_version: Hex16
    calendar_fingerprint: Hex64
    facts_version: Hex16
    cutoff: Stamp
    generated_at: Stamp
    _clocks = field_validator("cutoff", "generated_at")(_stamp)


class PublicationIdentity(Strict):
    fingerprint: Hex64
    collected_at: Stamp
    selected_at: Stamp
    _clocks = field_validator("collected_at", "selected_at")(_stamp)


class DirectoryNode(Strict):
    display_id: DisplayID
    kind: Literal["competition", "league", "series", "tournament"]
    parent_id: DisplayID | None
    label: Label
    name: Name | None
    full_name: Name | None
    season: Label | None
    year: Annotated[int, Field(ge=1900, le=2200)] | None
    identity_basis: Literal["source_identity", "observed_label", "unresolved_metadata"]
    metadata_conflicted: bool
    parent_conflicted: bool
    _text = field_validator("label", "name", "full_name", "season")(_clean)


class CardV2(Strict):
    display_id: DisplayID
    sport: Literal["football", "valorant"]
    competition_label: Label
    team_a: TeamCard | None
    team_b: TeamCard | None
    kickoff_utc: Stamp | None
    day_utc: Day | None
    kickoff_label: Annotated[str, Field(pattern=r"^\d{2}:\d{2} UTC$")] | None
    status_label: Literal["Scheduled", "In progress", "Finished", "Cancelled", "Postponed", "Unknown"]
    series_format: Annotated[str, Field(pattern=r"^(Single match|Best of ([1-9]|[1-9][0-9]|10[01]))$")] | None
    score_label: Annotated[str, Field(pattern=r"^(0|[1-9][0-9]{0,2}|1000)–(0|[1-9][0-9]{0,2}|1000)$")] | None
    result_state: Literal["unavailable", "provisional", "final", "source_reported"]
    winning_side: Literal["team_a", "team_b", "draw"] | None
    event_node_ids: Annotated[list[DisplayID], Field(max_length=3)]
    announcement_label: Name | None
    kickoff_precision: Literal["utc", "source_date", "timezone_unknown", "unknown"]
    kickoff_source_text: Annotated[str, Field(min_length=1, max_length=100)] | None
    resolution: Literal["validated", "pending", "conflicted", "legacy"]
    pending_reasons: Annotated[list[str], Field(max_length=8)]
    association_state: Literal["none", "canonical_record", "associated_historical", "matches_latest_announcement"]
    _text = field_validator("competition_label", "announcement_label", "kickoff_source_text")(_clean)

    @field_validator("kickoff_utc")
    @classmethod
    def kickoff(cls, value):
        return _stamp(value) if value is not None else None


class CoverageV2(Coverage):
    unknown_utc_total: Count
    eligible_total: Count
    eligible_undated_total: Count
    pending_total: Count
    pending_displayed: Count
    directory_nodes_displayed: Annotated[int, Field(ge=0, le=MAX_NODES)]
    note: Annotated[str, Field(min_length=1, max_length=2000)]
    _note = field_validator("note")(_clean)


class ProviderDisplayV2(Strict):
    schema_version: Literal["arena-live-display-2.0"]
    data_kind: Literal["processed_api_display"]
    provider: Provider
    facts_version: Hex16
    canonical: CanonicalIdentity | None
    calendar: CalendarIdentity | None
    publication: PublicationIdentity | None
    directory_status: Literal["observed", "not_supplied"]
    directory_nodes: Annotated[list[DirectoryNode], Field(max_length=MAX_NODES)]
    health: Health
    coverage: CoverageV2
    attribution: Credit
    license_note: str
    cards: Annotated[list[CardV2], Field(max_length=MAX_CARDS)]


class ManifestV2(Strict):
    schema_version: Literal["arena-live-display-2.0"]
    data_kind: Literal["processed_api_display"]
    display_version: Hex16
    package_fingerprint: Hex64
    generated_at: Stamp
    window_day_utc: Day
    providers: list[Provider]
    facts_versions: dict[Provider, Hex16]
    files: dict[str, Hex64]
    processing_note: Annotated[str, Field(min_length=1, max_length=1000)]
    _clock = field_validator("generated_at")(_stamp)
    _note = field_validator("processing_note")(_clean)


def _checked(model, value):
    try:
        body = model.model_validate(value).model_dump()
    except (ValueError, TypeError):
        raise DisplayError("invalid_display_contract") from None
    if body != value:
        raise DisplayError("noncanonical_display_fields")
    return body


def facts(payload):
    """Displayed business facts, excluding source/build clocks and diagnostics."""
    return dict(provider=payload["provider"],
                cards=sorted(payload["cards"], key=lambda row: row["display_id"]),
                directory_nodes=sorted(payload["directory_nodes"], key=lambda row: row["display_id"]),
                directory_status=payload["directory_status"],
                coverage={key: value for key, value in payload["coverage"].items()
                          if key not in ("unsupported_last_poll", "note")})


def fingerprint(version, files):
    return _hash(_canonical(dict(schema_version=SCHEMA, display_version=version, files=files)))


def _sort(card):
    known = card["kickoff_utc"] is not None
    rank = (0 if card["status_label"] == "In progress" else
            1 if card["status_label"] == "Scheduled" and known else 2 if not known else 3)
    if known:
        delta = utc_time(card["kickoff_utc"])-utc_time("1970-01-01T00:00:00Z")
        instant = (delta.days*86400+delta.seconds)*1_000_000+delta.microseconds
    else:
        instant = 0
    return rank, not known, -instant if rank == 3 else instant, card["display_id"]


def _source_clock(value, precision):
    if value is None:
        return False
    try:
        if precision == "source_date":
            return re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None and date.fromisoformat(value) is not None
        pattern = r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?"
        if precision == "timezone_unknown":
            return re.fullmatch(pattern, value) is not None and datetime.fromisoformat(value).tzinfo is None
        return (re.fullmatch(pattern + r"(Z|[+-]\d{2}:?\d{2})", value) is not None
                and datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None)
    except (TypeError, ValueError, OverflowError):
        return False


def _node_id(provider, row, kind):
    metadata = getattr(row, kind)
    if metadata is None:
        return None
    identity = metadata.id or row.announcement_id + "\0" + kind
    return _identity(provider, identity, "event:" + kind if metadata.id else "unresolved:" + kind)


def _directory(calendar, provider):
    observations = {}
    # Occurrences preserve conflicting source metadata rather than only the
    # aggregation winner. Cards still use their latest announcement fields.
    for row in calendar.occurrences:
        for kind, parent_kind in (("league", None), ("series", "league"), ("tournament", "series")):
            metadata = getattr(row, kind)
            node_id = _node_id(provider, row, kind)
            if node_id is None:
                continue
            fields = dict(name=_text(metadata.name, 240), full_name=_text(metadata.full_name, 240),
                          season=_text(metadata.season), year=metadata.year)
            parent = _node_id(provider, row, parent_kind) if parent_kind else None
            observations.setdefault(node_id, []).append((kind, fields, parent, metadata.id is not None))
    nodes = {}
    for node_id, variants in observations.items():
        kind = variants[0][0]
        fields = {key: variants[0][1][key] if len({row[1][key] for row in variants}) == 1 else None
                  for key in ("name", "full_name", "season", "year")}
        parents = {row[2] for row in variants}
        nodes[node_id] = dict(display_id=node_id, kind=kind, parent_id=next(iter(parents)) if len(parents) == 1 else None,
                             label=_text(fields["full_name"] or fields["name"]) or f"Unnamed source {kind}",
                             **fields, identity_basis="source_identity" if variants[0][3] else "unresolved_metadata",
                             metadata_conflicted=len({_canonical(row[1]) for row in variants}) > 1,
                             parent_conflicted=len(parents) > 1)
    return nodes


def _team(provider, team):
    if team is None or team.team_id is None or _text(team.team_name) is None:
        return None
    return dict(display_id=_identity(provider, team.team_id, "team"), label=_text(team.team_name))


def _scores(row):
    teams = (row.team_a, row.team_b)
    if (any(team is None or team.team_id is None or team.team_name is None for team in teams)
            or teams[0].team_id == teams[1].team_id or len(row.source_results) != 2):
        return None
    results = {result.team_id: result.score for result in row.source_results}
    if set(results) != {team.team_id for team in teams} or any(score is None for score in results.values()):
        return None
    return results[teams[0].team_id], results[teams[1].team_id]


def _agree(announcement, record):
    if record is None or announcement.conflicted or announcement.pending_reasons:
        return False
    if (announcement.team_a is None or announcement.team_b is None
            or announcement.start_time != record.start_time
            or SOURCE_STATUS.get(announcement.source_status) != {
                "scheduled": "Scheduled", "running": "In progress", "finished": "Finished",
                "cancelled": "Cancelled", "postponed": "Postponed"}.get(record.status)
            or announcement.source_number_of_games != record.best_of):
        return False
    if (announcement.team_a.team_id, announcement.team_a.team_name,
            announcement.team_b.team_id, announcement.team_b.team_name) != (
            record.team_a_id, record.team_a, record.team_b_id, record.team_b):
        return False
    # Canonical import retains raw scheduled score fields too. Agreement checks
    # those fields while result projection still suppresses scheduled scores.
    scores = _scores(announcement)
    expected = scores if scores is not None else (None, None)
    return expected == (record.score_a, record.score_b)


def _announcement(row, capture, now, nodes):
    provider = capture.provider
    kickoff = utc_time(row.start_time) if row.start_time else None
    source_text = row.source_dates.begin_at
    precision = "utc" if kickoff else "source_date" if _source_clock(source_text, "source_date") else (
        "timezone_unknown" if _source_clock(source_text, "timezone_unknown") else "unknown")
    if not _source_clock(source_text, precision):
        source_text = None
    references = [node_id for kind in ("league", "series", "tournament")
                  if (node_id := _node_id(provider, row, kind)) is not None]
    label = nodes[references[-1]]["label"] if references else "Event metadata not supplied"
    canonical = capture.dataset.by_id.get(row.canonical_match_id) if capture.dataset and row.canonical_match_id else None
    agrees = _agree(row, canonical)
    association = "matches_latest_announcement" if agrees else "associated_historical" if canonical else "none"
    resolution = "conflicted" if row.conflicted else "pending" if row.pending_reasons else "validated"
    team_a, team_b = _team(provider, row.team_a), _team(provider, row.team_b)
    if team_a and team_b and team_a["display_id"] == team_b["display_id"]:
        team_a = team_b = None
    scores = _scores(row)
    allowed = (scores is not None and kickoff is not None and kickoff <= now and not row.conflicted
               and row.source_status in ("running", "finished") and team_a is not None and team_b is not None)
    state = ("final" if agrees and row.source_status == "finished" else "provisional" if agrees else "source_reported") if allowed else "unavailable"
    winner = ("team_a" if scores[0] > scores[1] else "team_b" if scores[1] > scores[0] else "draw") if state == "final" else None
    return dict(display_id=_identity(provider, row.announcement_id), sport="valorant", competition_label=label,
                team_a=team_a, team_b=team_b, kickoff_utc=_stamp(row.start_time) if kickoff else None,
                day_utc=kickoff.date().isoformat() if kickoff else None,
                kickoff_label=kickoff.strftime("%H:%M UTC") if kickoff else None,
                status_label=SOURCE_STATUS.get(row.source_status, "Unknown"),
                series_format=f"Best of {row.source_number_of_games}" if row.source_number_of_games else None,
                score_label=f"{scores[0]}–{scores[1]}" if allowed else None, result_state=state, winning_side=winner,
                event_node_ids=references, announcement_label=_text(row.name, 240), kickoff_precision=precision,
                kickoff_source_text=source_text, resolution=resolution, pending_reasons=list(row.pending_reasons),
                association_state=association), canonical if agrees else None


def _canonical_card(row, now, legacy, nodes):
    card = _card(row, now)
    references = []
    if not legacy and row.provider == "football-data":
        node_id = _identity(row.provider, row.competition, "competition")
        nodes[node_id] = dict(display_id=node_id, kind="competition", parent_id=None,
                              label=row.competition, name=row.competition, full_name=None, season=None,
                              year=None, identity_basis="observed_label", metadata_conflicted=False, parent_conflicted=False)
        references.append(node_id)
    return dict(**card, event_node_ids=references, announcement_label=None, kickoff_precision="utc",
                kickoff_source_text=None, resolution="legacy" if legacy else "validated",
                pending_reasons=[], association_state="canonical_record")


def _health(capture, now):
    status, publication = capture.status, capture.publication
    success = publication.collected_at if publication else status.last_success_at if status else None
    cadence = status.poll_interval_seconds if status else None
    threshold = max(120, 2 * cadence) if cadence else 120 if publication else None
    age = (now-utc_time(success)).total_seconds() if success else None
    stale = (age is None or threshold is None or age > threshold
             or capture.state in ("invalid_publication", "not_connected") or capture.serving_last_good)
    state = "stale" if stale and capture.state == "ready" else capture.state
    error = capture.error or (status.last_error_code if status else None)
    if error is not None and error not in ERROR_CODES:
        error = "invalid_publication"
    scope = publication.source_scope.model_dump(mode="json") if publication else (
        status.source_scope.model_dump() if status and status.source_scope else None)
    return dict(state=state, producer_state=status.status if status else None, stale=stale,
                serving_last_good=capture.serving_last_good, last_attempt_at=status.last_attempt_at if status else None,
                last_success_at=success, last_change_at=None if publication else status.last_change_at if status else None,
                poll_interval_seconds=cadence, stale_after_seconds=threshold, source_scope=scope,
                attempt_scope=status.source_scope.model_dump() if status and status.source_scope else None,
                freshness_scope="declared_poll_scope" if scope else "unknown_poll_scope", error_code=error,
                scores_delayed=True if capture.provider == "football-data" else None,
                update_mode="polled_rest", in_game_round_feed=False)


def _projection_manifest(payload, now):
    files = {name: "0"*64 for name in FILES}
    return dict(schema_version=SCHEMA, data_kind="processed_api_display", display_version="0"*16,
                package_fingerprint=fingerprint("0"*16, files), generated_at=_stamp(now.isoformat()),
                window_day_utc=now.date().isoformat(), providers=list(PROVIDERS),
                facts_versions={provider: payload["facts_version"] if provider == payload["provider"] else "0"*16
                                for provider in PROVIDERS}, files=files, processing_note="Bounded processed display")


def project_provider(capture, now, limit=MAX_CARDS):
    """Return one validated public body and separate eligible private links."""
    now = _clock(now)
    if type(limit) is not int or not 1 <= limit <= MAX_CARDS:
        raise DisplayError("card_limit_out_of_bounds")
    if capture.provider not in PROVIDERS or capture.now > now:
        raise DisplayError("capture_clock_or_provider_mismatch")
    dataset, calendar, publication = capture.dataset, capture.calendar, capture.publication
    # Private football records already provide observed competition labels.
    # PandaScore without its calendar cannot supply the event directory.
    legacy = capture.provider == "pandascore" and calendar is None
    nodes = _directory(calendar, capture.provider) if calendar else {}
    projected, records = [], {}
    if calendar:
        for row in calendar.announcements:
            card, record = _announcement(row, capture, now, nodes)
            projected.append(card)
            if record:
                records[card["display_id"]] = record
    elif dataset:
        for record in dataset.by_id.values():
            card = _canonical_card(record, now, legacy, nodes)
            projected.append(card)
            records[card["display_id"]] = record
    begin, through = now.date()-timedelta(days=14), now.date()+timedelta(days=30)
    eligible = [card for card in projected if card["day_utc"] is None
                or begin.isoformat() <= card["day_utc"] <= through.isoformat()
                or card["status_label"] == "In progress"]
    eligible.sort(key=_sort)
    cards, referenced = [], set()
    for card in eligible[:limit]:
        added = set(card["event_node_ids"])
        for node_id in tuple(added):
            parent = nodes[node_id]["parent_id"]
            while parent:
                added.add(parent)
                parent = nodes[parent]["parent_id"]
        if len(referenced | added) > MAX_NODES:
            break
        cards.append(card)
        referenced.update(added)
    unknown = sum(card["day_utc"] is None for card in projected)
    window = len(eligible)-unknown
    canonical = (dict(dataset_version=dataset.manifest["dataset_version"], snapshot_fingerprint=dataset.fingerprint,
                      cutoff=_stamp(dataset.manifest["as_of"]),
                      generated_at=_stamp(dataset.manifest["generated_at"])) if dataset else None)
    cal_identity = (dict(dataset_version=calendar.manifest["dataset_version"], calendar_fingerprint=calendar.calendar_fingerprint,
                         facts_version=calendar.facts_version[:16], cutoff=_stamp(calendar.manifest["as_of"]),
                         generated_at=_stamp(calendar.manifest["generated_at"])) if calendar else None)
    pub_identity = (dict(fingerprint=publication.fingerprint, collected_at=publication.collected_at,
                         selected_at=publication.selected_at) if publication else None)
    coverage = dict(retained_total=len(projected), window_total=window, displayed=len(cards), clipped=len(eligible)-len(cards),
                    outside_window=len(projected)-len(eligible), unknown_utc_total=unknown, eligible_total=len(eligible),
                    eligible_undated_total=unknown, pending_total=sum(bool(card["pending_reasons"]) for card in projected),
                    pending_displayed=sum(bool(card["pending_reasons"]) for card in cards), directory_nodes_displayed=len(referenced),
                    running_outside_window=sum(card["status_label"] == "In progress" and card["day_utc"] is not None
                        and not begin.isoformat() <= card["day_utc"] <= through.isoformat() for card in eligible),
                    unsupported_last_poll=capture.status.last_poll.unsupported_rows if capture.status else None,
                    card_limit=limit, window_from=begin.isoformat(), window_through=through.isoformat(),
                    window_day_utc=now.date().isoformat(),
                    note="Observed bounded source announcements in the UTC window, unresolved UTC dates, and source-reported running matches; clipping does not establish complete provider coverage.")
    payload = dict(schema_version=SCHEMA, data_kind="processed_api_display", provider=capture.provider,
                   canonical=canonical, calendar=cal_identity, publication=pub_identity,
                   directory_status="observed" if calendar is not None or (
                       capture.provider == "football-data" and dataset is not None and dataset.by_id) else "not_supplied",
                   directory_nodes=sorted((nodes[key] for key in referenced), key=lambda node: node["display_id"]),
                   health=_health(capture, now), coverage=coverage, attribution=ATTRIBUTION[capture.provider],
                   license_note=LICENSE_NOTE, cards=cards)
    payload["facts_version"] = _hash(_canonical(facts(payload)))[:16]
    body = validate_provider(payload, _projection_manifest(payload, now), now)
    if len(_canonical(body)+b"\n") > MAX_FILE_BYTES:
        raise DisplayError("size_limit")
    links = {card["display_id"]: dict(match_id=records[card["display_id"]].match_id,
                                     snapshot_fingerprint=dataset.fingerprint)
             for card in cards if card["display_id"] in records
             and re.fullmatch(re.escape(capture.provider)+r":[0-9]{1,20}",
                              records[card["display_id"]].match_id) is not None}
    return body, links


def validate_provider(payload, manifest, now):
    """Independently validate exact v2 wire types and business invariants."""
    try:
        return _validate_provider(payload, manifest, now)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        if isinstance(error, DisplayError):
            raise
        raise DisplayError("invalid_display_contract") from None


def _validate_provider(payload, manifest, now):
    now = _clock(now)
    payload, manifest = _checked(ProviderDisplayV2, payload), _checked(ManifestV2, manifest)
    provider, health, coverage = payload["provider"], payload["health"], payload["coverage"]
    published = utc_time(manifest["generated_at"])
    if (manifest["providers"] != list(PROVIDERS) or set(manifest["files"]) != set(FILES)
            or set(manifest["facts_versions"]) != set(PROVIDERS) or published > now
            or manifest["window_day_utc"] != published.date().isoformat()):
        raise DisplayError("invalid_provider_inventory_or_clock")
    if manifest["facts_versions"][provider] != payload["facts_version"]:
        raise DisplayError("provider_or_facts_version_mismatch")
    if payload["attribution"] != ATTRIBUTION[provider] or payload["license_note"] != LICENSE_NOTE:
        raise DisplayError("attribution_mismatch")
    if health["scores_delayed"] is not (True if provider == "football-data" else None):
        raise DisplayError("provider_capability_mismatch")
    for key in ("last_attempt_at", "last_success_at", "last_change_at"):
        if health[key] is not None and utc_time(health[key]) > published:
            raise DisplayError("future_source_clock")
    if health["last_change_at"] and (not health["last_success_at"] or health["last_change_at"] > health["last_success_at"]):
        raise DisplayError("source_clock_order")
    pub, cal, canonical = payload["publication"], payload["calendar"], payload["canonical"]
    threshold = (max(120, 2*health["poll_interval_seconds"]) if health["poll_interval_seconds"] else 120 if pub else None)
    age = (published-utc_time(health["last_success_at"])).total_seconds() if health["last_success_at"] else None
    stale = (age is None or threshold is None or age > threshold or health["state"] in ("invalid_publication", "not_connected")
             or health["serving_last_good"])
    if (health["stale_after_seconds"] != threshold or health["stale"] != stale
            or age is not None and threshold is None
            or health["state"] in ("ready", "stale", "empty") and health["last_success_at"] is None
            or health["state"] == "ready" and stale or health["state"] == "stale" and not stale):
        raise DisplayError("freshness_mismatch")
    scope = health["source_scope"]
    if health["freshness_scope"] != ("declared_poll_scope" if scope else "unknown_poll_scope"):
        raise DisplayError("poll_scope_mismatch")
    for item in (scope, health["attempt_scope"]):
        if item is None:
            continue
        if (len(set(item["competition_codes"])) != len(item["competition_codes"])
                or len(set(item["phases"])) != len(item["phases"])
                or provider == "football-data" and (item["kind"] != "competition_list" or not item["competition_codes"] or item["phases"])
                or provider == "pandascore" and (item["kind"] != "match_phases" or item["competition_codes"] or not item["phases"])):
            raise DisplayError("poll_scope_mismatch")
    for identity in (canonical, cal):
        if identity is not None:
            if (not utc_time(identity["cutoff"]) <= utc_time(identity["generated_at"]) <= published
                    or health["last_success_at"] and utc_time(identity["cutoff"]) > utc_time(health["last_success_at"])):
                raise DisplayError("canonical_clock_mismatch")
    if cal is not None and provider != "pandascore":
        raise DisplayError("provider_calendar_mismatch")
    if pub:
        if (not utc_time(pub["collected_at"]) <= utc_time(pub["selected_at"]) <= published
                or health["last_success_at"] != pub["collected_at"] or scope is None
                or health["last_change_at"] is not None
                or any(identity and (utc_time(identity["generated_at"]) > utc_time(pub["selected_at"])
                                     or utc_time(identity["cutoff"]) > utc_time(pub["collected_at"]))
                       for identity in (canonical, cal))
                or provider == "pandascore" and cal is None):
            raise DisplayError("publication_clock_or_scope_mismatch")
    if cal is not None and pub is None:
        raise DisplayError("calendar_without_publication")
    observed_source = cal is not None or (provider == "football-data" and canonical is not None
                                         and coverage["retained_total"] > 0)
    legacy_adaptation = (cal is None and pub is None and payload["directory_status"] == "not_supplied"
                         and all(card["resolution"] == "legacy" for card in payload["cards"]))
    if payload["directory_status"] != ("observed" if observed_source else "not_supplied") and not legacy_adaptation:
        raise DisplayError("directory_source_mismatch")
    if canonical is None and cal is None and (payload["cards"] or coverage["retained_total"] or health["serving_last_good"] or health["state"] == "ready"):
        raise DisplayError("unavailable_provider_has_data")
    window_day = date.fromisoformat(coverage["window_day_utc"])
    if (window_day > published.date() or window_day != published.date() and not health["serving_last_good"]
            or coverage["window_from"] != (window_day-timedelta(days=14)).isoformat()
            or coverage["window_through"] != (window_day+timedelta(days=30)).isoformat()):
        raise DisplayError("window_mismatch")
    cards, nodes = payload["cards"], {node["display_id"]: node for node in payload["directory_nodes"]}
    if (coverage["displayed"] != len(cards) or len(cards) > coverage["card_limit"]
            or coverage["eligible_total"] != coverage["window_total"]+coverage["unknown_utc_total"]
            or coverage["eligible_undated_total"] != coverage["unknown_utc_total"]
            or coverage["retained_total"] != coverage["window_total"]+coverage["outside_window"]+coverage["unknown_utc_total"]
            or coverage["displayed"]+coverage["clipped"] != coverage["eligible_total"]
            or coverage["running_outside_window"] > coverage["window_total"]
            or coverage["pending_total"] > coverage["retained_total"]
            or coverage["pending_displayed"] > coverage["pending_total"]
            or coverage["directory_nodes_displayed"] != len(nodes)):
        raise DisplayError("coverage_counts_mismatch")
    if len(nodes) != len(payload["directory_nodes"]):
        raise DisplayError("duplicate_directory_identity")
    referenced, seen = set(), set()
    for node in nodes.values():
        if (not node["display_id"].startswith(provider+"-")
                or node["parent_conflicted"] and node["parent_id"] is not None
                or provider == "football-data" and (node["kind"] != "competition" or node["parent_id"] is not None)
                or provider == "pandascore" and node["kind"] == "competition"):
            raise DisplayError("invalid_directory_node")
        parent = nodes.get(node["parent_id"])
        if node["parent_id"] is not None and (parent is None or parent["kind"] != {
                "series": "league", "tournament": "series"}.get(node["kind"])):
            raise DisplayError("invalid_directory_parent")
    if payload["directory_status"] == "not_supplied" and nodes:
        raise DisplayError("unsupplied_directory_has_nodes")
    for card in cards:
        if card["display_id"] in seen or not card["display_id"].startswith(provider+"-"):
            raise DisplayError("duplicate_or_cross_provider_card")
        seen.add(card["display_id"])
        teams = (card["team_a"], card["team_b"])
        if (any(team and not team["display_id"].startswith(provider+"-") for team in teams)
                or all(teams) and teams[0]["display_id"] == teams[1]["display_id"]
                or card["sport"] != ("football" if provider == "football-data" else "valorant")):
            raise DisplayError("invalid_display_teams_or_sport")
        refs, reasons = card["event_node_ids"], card["pending_reasons"]
        if (len(refs) > (1 if provider == "football-data" else 3) or len(set(refs)) != len(refs)
                or any(key not in nodes for key in refs) or reasons != sorted(set(reasons)) or not set(reasons) <= PENDING):
            raise DisplayError("invalid_card_references_or_pending")
        ranks = [KINDS.index(nodes[key]["kind"]) for key in refs]
        if ranks != sorted(set(ranks)):
            raise DisplayError("invalid_card_hierarchy_order")
        referenced.update(refs)
        latest = card["association_state"] == "matches_latest_announcement"
        legacy_card = card["resolution"] == "legacy"
        if (latest and (provider != "pandascore" or cal is None or canonical is None
                        or card["resolution"] != "validated" or reasons)
                or card["association_state"] == "associated_historical" and (cal is None or canonical is None)
                or legacy_card and (pub is not None or cal is not None or payload["directory_status"] != "not_supplied"
                                    or card["association_state"] != "canonical_record" or reasons)
                or reasons and card["resolution"] not in ("pending", "conflicted")
                or card["resolution"] == "conflicted" and "conflicting_phase_records" not in reasons
                or card["association_state"] == "canonical_record" and not (
                    canonical is not None and (legacy_card or provider == "football-data"
                    and card["resolution"] == "validated" and cal is None))):
            raise DisplayError("invalid_card_association")
        kickoff = utc_time(card["kickoff_utc"]) if card["kickoff_utc"] else None
        if card["kickoff_precision"] == "utc":
            if (kickoff is None or card["day_utc"] != kickoff.date().isoformat()
                    or card["kickoff_label"] != kickoff.strftime("%H:%M UTC")
                    or not coverage["window_from"] <= card["day_utc"] <= coverage["window_through"] and card["status_label"] != "In progress"):
                raise DisplayError("derived_date_mismatch")
        elif any(card[key] is not None for key in ("kickoff_utc", "day_utc", "kickoff_label")):
            raise DisplayError("unconfirmed_utc_date")
        precision, source_text = card["kickoff_precision"], card["kickoff_source_text"]
        if (source_text is not None and not _source_clock(source_text, precision)
                or precision in ("source_date", "timezone_unknown") and source_text is None
                or precision == "unknown" and source_text is not None):
            raise DisplayError("invalid_source_date")
        if card["series_format"] is not None and (provider == "football-data") != (card["series_format"] == "Single match"):
            raise DisplayError("series_format_mismatch")
        score = card["score_label"]
        if score is None:
            if card["result_state"] != "unavailable" or card["winning_side"] is not None:
                raise DisplayError("unconfirmed_result_mismatch")
        else:
            if (card["status_label"] not in ("Finished", "In progress") or not all(teams)
                    or card["resolution"] == "conflicted" or kickoff is None or kickoff > published):
                raise DisplayError("result_before_start_or_wrong_status")
            a, b = map(int, score.split("–"))
            latest = card["resolution"] == "validated" and card["association_state"] == "matches_latest_announcement"
            canonical_only = card["association_state"] == "canonical_record" and (
                provider == "football-data" and card["resolution"] == "validated" and cal is None
                or card["resolution"] == "legacy" and cal is None and pub is None and payload["directory_status"] == "not_supplied")
            if card["result_state"] in ("final", "provisional"):
                if canonical is None or not (latest or canonical_only) or max(a, b) > 50:
                    raise DisplayError("unverified_canonical_result")
                if card["result_state"] == "final":
                    winner = "team_a" if a > b else "team_b" if b > a else "draw"
                    if card["status_label"] != "Finished" or card["winning_side"] != winner:
                        raise DisplayError("derived_result_mismatch")
                    if provider == "pandascore":
                        best_of = int(card["series_format"].split()[-1]) if card["series_format"] else 0
                        need = best_of//2+1
                        if not best_of or best_of % 2 == 0 or max(a, b) != need or min(a, b) >= need:
                            raise DisplayError("invalid_series_result")
                elif card["status_label"] != "In progress" or card["winning_side"] is not None:
                    raise DisplayError("derived_result_mismatch")
            elif (card["result_state"] != "source_reported" or card["winning_side"] is not None
                  or provider != "pandascore" or cal is None):
                raise DisplayError("unconfirmed_result_mismatch")
    for node_id in tuple(referenced):
        parent = nodes[node_id]["parent_id"]
        while parent:
            referenced.add(parent)
            parent = nodes[parent]["parent_id"]
    if (referenced != set(nodes) or coverage["pending_displayed"] != sum(bool(card["pending_reasons"]) for card in cards)
            or sum(card["day_utc"] is None for card in cards) > coverage["unknown_utc_total"]
            or cards != sorted(cards, key=_sort)):
        raise DisplayError("directory_coverage_or_order_mismatch")
    if payload["facts_version"] != _hash(_canonical(facts(payload)))[:16]:
        raise DisplayError("facts_version_mismatch")
    return payload


def adapt_legacy(payload, published):
    """Adapt an already verified v1 body; never mutate its wire or identities."""
    from .live_publication import ProviderDisplay, _checked as checked_v1

    payload = checked_v1(ProviderDisplay, payload)
    body = json.loads(_canonical(payload))
    body.update(schema_version=SCHEMA, calendar=None, publication=None,
                directory_status="not_supplied", directory_nodes=[])
    for card in body["cards"]:
        card.update(event_node_ids=[], announcement_label=None, kickoff_precision="utc", kickoff_source_text=None,
                    resolution="legacy", pending_reasons=[], association_state="canonical_record")
    body["coverage"].update(unknown_utc_total=0, eligible_total=body["coverage"]["window_total"],
                            eligible_undated_total=0, pending_total=0, pending_displayed=0, directory_nodes_displayed=0)
    body["facts_version"] = _hash(_canonical(facts(body)))[:16]
    now = _clock(utc_time(published) if isinstance(published, str) else published)
    return validate_provider(body, _projection_manifest(body, now), now)


def _successful_clock(payload):
    pub = payload["publication"]
    if pub:
        return utc_time(pub["collected_at"])
    success = payload["health"]["last_success_at"]
    if success:
        return utc_time(success)
    clocks = [utc_time(source["cutoff"]) for source in (payload["canonical"], payload["calendar"]) if source]
    return max(clocks) if clocks else None


def recovery_is_newer(current, previous):
    if previous["canonical"] is None and previous["calendar"] is None:
        return False
    if current["publication"] is not None and previous["publication"] is None:
        return False
    if current["canonical"] is None and current["calendar"] is None and current["publication"] is None:
        return True
    old, new = _successful_clock(previous), _successful_clock(current)
    if old is None:
        return False
    if new is None:
        return True
    return old > new


def recover_provider(current, previous):
    """Retain one entire verified evidence unit while keeping attempt telemetry."""
    body = json.loads(_canonical(current))
    for key in ("canonical", "calendar", "publication", "directory_status", "directory_nodes", "coverage", "cards", "facts_version"):
        body[key] = json.loads(_canonical(previous[key]))
    health, old = body["health"], previous["health"]
    for key in ("last_success_at", "last_change_at", "poll_interval_seconds", "stale_after_seconds", "source_scope", "freshness_scope"):
        health[key] = json.loads(_canonical(old[key]))
    health["serving_last_good"] = health["stale"] = True
    if health["state"] in ("ready", "empty", "stale"):
        health["state"] = "degraded"
    return _checked(ProviderDisplayV2, body)
