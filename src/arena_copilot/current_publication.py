"""Independent consumer validation of paired private provider publications.

These checks establish bounded package consistency, not provider authenticity.
No producer runtime, network client, archive discovery or null filling is used.
"""

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PHASES = ("past", "upcoming", "running")
CALENDAR_FILES = ("announcements.json", "occurrences.json", "sources.json", "quality.json")
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_RECORDS = 3000
Hex64 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Hex16 = Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]
Stamp = Annotated[str, Field(min_length=1, max_length=100)]
Text = Annotated[str, Field(min_length=1, max_length=1000)]
SourceInteger = Annotated[int, Field(ge=1, le=2**53 - 1)]
MatchID = Annotated[str, Field(pattern=r"^pandascore:[1-9][0-9]{0,15}$")]
SourceID = Annotated[str, Field(pattern=r"^pandascore:valorant:(past|upcoming|running):page:([1-9]|10)$")]
OccurrenceID = Annotated[str, Field(pattern=r"^pandascore:valorant:(past|upcoming|running):page:([1-9]|10):row:[0-9]{3}$")]
PENDING = frozenset(("unresolved_opponents", "unresolved_team_names", "unsupported_opponent_type",
                    "unresolved_start_time", "start_time_timezone_unknown", "unknown_status",
                    "result_unavailable", "conflicting_phase_records"))
Count = Annotated[int, Field(ge=0, le=MAX_RECORDS)]


class PairError(ValueError):
    """Fixed safe error code; never contains provider values or private paths."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _pairs(items):
    value = {}
    for key, item in items:
        if key in value:
            raise PairError("duplicate_json_key")
        value[key] = item
    return value


def parse_json(body):
    try:
        return json.loads(body.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(PairError("nonfinite_json")))
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise PairError("invalid_json") from None


def utc(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Aware UTC timestamp required")
    return parsed.astimezone(timezone.utc)


def stamp(value):
    return utc(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def source_date(value):
    if value is not None:
        if "T" in value or " " in value:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            date.fromisoformat(value)
    return value


def safe(path):
    for parent in (path, *path.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise PairError("unsafe_path")


def read_bytes(path, limit):
    safe(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise PairError("size_or_type_limit")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if not stat.S_ISREG(opened.st_mode) or (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
            raise PairError("unsafe_path")
        body = handle.read(limit + 1)
    if len(body) > limit:
        raise PairError("size_or_type_limit")
    return body


def freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(freeze(item) for item in value)
    return value


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def array(value):
    if not isinstance(value, (list, tuple)):
        raise ValueError("JSON array required")
    return tuple(value)


class PublicationScope(Frozen):
    kind: Literal["competition_list", "match_phases"]
    competition_codes: Annotated[tuple[Annotated[str, Field(pattern=r"^[A-Z0-9]{1,12}$")], ...], Field(max_length=10)]
    phases: Annotated[tuple[Literal["past", "upcoming", "running"], ...], Field(max_length=3)]
    pages: Annotated[int, Field(ge=1, le=10)]
    _arrays = field_validator("competition_codes", "phases", mode="before")(array)

    @model_validator(mode="after")
    def coherence(self):
        if self.kind == "competition_list":
            if not self.competition_codes or len(set(self.competition_codes)) != len(self.competition_codes) or self.phases or self.pages != 1:
                raise ValueError("Invalid football scope")
        elif self.competition_codes or self.phases != PHASES:
            raise ValueError("Incomplete PandaScore scope")
        return self


class Descriptor(Frozen):
    basename: Annotated[str, Field(min_length=1, max_length=80)]
    dataset_version: Hex16
    manifest_sha256: Hex64


class CurrentPublication(Frozen):
    schema_version: Literal["arena-provider-publication-1.0"]
    provider: Literal["football-data", "pandascore"]
    data_kind: Literal["api"]
    poll_id: Annotated[int, Field(ge=1, le=2**63 - 1)]
    source_scope: PublicationScope
    collected_at: Stamp
    selected_at: Stamp
    canonical: Descriptor | None
    calendar: Descriptor | None
    fingerprint: Hex64
    _clocks = field_validator("collected_at", "selected_at")(stamp)

    @model_validator(mode="after")
    def coherence(self):
        if self.collected_at > self.selected_at:
            raise ValueError("Selection precedes complete collection")
        if self.source_scope.kind != ("competition_list" if self.provider == "football-data" else "match_phases"):
            raise ValueError("Provider scope mismatch")
        if self.provider == "football-data" and self.calendar is not None or self.provider == "pandascore" and self.calendar is None:
            raise ValueError("Provider calendar mismatch")
        for kind, descriptor, pattern in (("canonical", self.canonical, r"snapshot-([0-9a-f]{16})-[0-9a-f]{8}"),
                                           ("calendar", self.calendar, r"calendar-([0-9a-f]{16})")):
            if descriptor:
                match = re.fullmatch(pattern, descriptor.basename)
                if match is None or match[1] != descriptor.dataset_version:
                    raise ValueError(f"Invalid {kind} descriptor")
        return self


def parse_publication(body, provider, now):
    raw = parse_json(body)
    if not isinstance(raw, dict) or raw.get("fingerprint") != hashlib.sha256(canonical({
            key: value for key, value in raw.items() if key != "fingerprint"})).hexdigest():
        raise PairError("publication_fingerprint_mismatch")
    try:
        result = CurrentPublication.model_validate(raw)
    except ValueError:
        raise PairError("invalid_publication_contract") from None
    if result.provider != provider:
        raise PairError("publication_provider_mismatch")
    if utc(result.selected_at) > now:
        raise PairError("future_timestamp")
    return result


class SourceDates(Frozen):
    begin_at: Stamp | None
    scheduled_at: Stamp | None
    original_scheduled_at: Stamp | None
    end_at: Stamp | None
    modified_at: Stamp | None
    _dates = field_validator("begin_at", "scheduled_at", "original_scheduled_at", "end_at", "modified_at")(source_date)


class Team(Frozen):
    team_id: MatchID | None
    source_team_id: SourceInteger | None
    team_name: Text | None


class EventMetadata(Frozen):
    id: Annotated[str, Field(pattern=r"^pandascore:(league|series|tournament):[1-9][0-9]{0,15}$")] | None
    source_id: SourceInteger | None
    name: Text | None
    full_name: Text | None
    begin_at: Stamp | None
    end_at: Stamp | None
    modified_at: Stamp | None
    season: Text | None
    year: Annotated[int, Field(ge=1900, le=2200)] | None
    _dates = field_validator("begin_at", "end_at", "modified_at")(source_date)


class Result(Frozen):
    team_id: MatchID | None
    source_team_id: SourceInteger | None
    score: Annotated[int, Field(ge=0, le=1000)] | None


class Business(Frozen):
    announcement_id: MatchID
    provider: Literal["pandascore"]
    sport: Literal["valorant"]
    name: Text | None
    source_status: Annotated[str, Field(min_length=1, max_length=40)]
    start_time: Stamp | None
    source_dates: SourceDates
    team_a: Team | None
    team_b: Team | None
    league: EventMetadata | None
    series: EventMetadata | None
    tournament: EventMetadata | None
    source_number_of_games: Annotated[int, Field(ge=1, le=101)] | None
    source_results: Annotated[tuple[Result, ...], Field(max_length=8)]
    result_known: bool
    pending_reasons: Annotated[tuple[Annotated[str, Field(max_length=40)], ...], Field(max_length=8)]
    _arrays = field_validator("source_results", "pending_reasons", mode="before")(array)
    _start = field_validator("start_time")(lambda value: stamp(value) if value is not None else None)

    @model_validator(mode="after")
    def reasons(self):
        if tuple(sorted(set(self.pending_reasons))) != self.pending_reasons or not set(self.pending_reasons) <= PENDING:
            raise ValueError("Invalid pending reasons")
        return self


class Occurrence(Business):
    occurrence_id: OccurrenceID
    source_id: SourceID
    observed_at: Stamp
    _clock = field_validator("observed_at")(stamp)


class Announcement(Business):
    canonical_match_id: MatchID | None
    observed_at: Stamp
    first_observed_at: Stamp
    last_observed_at: Stamp
    source_ids: Annotated[tuple[SourceID, ...], Field(min_length=1, max_length=30)]
    occurrence_ids: Annotated[tuple[OccurrenceID, ...], Field(min_length=1, max_length=MAX_RECORDS)]
    conflicted: bool
    _arrays2 = field_validator("source_ids", "occurrence_ids", mode="before")(array)
    _clocks = field_validator("observed_at", "first_observed_at", "last_observed_at")(stamp)


class Source(Frozen):
    source_id: SourceID
    provider: Literal["pandascore"]
    phase: Literal["past", "upcoming", "running"]
    page: Annotated[int, Field(ge=1, le=10)]
    per_page: Literal[100]
    endpoint: Annotated[str, Field(min_length=1, max_length=100)]
    requested_at: Stamp
    observed_at: Stamp
    archive_sha256: Hex64
    record_count: Annotated[int, Field(ge=0, le=100)]
    _clocks = field_validator("requested_at", "observed_at")(stamp)


class Quality(Frozen):
    source_records: Count
    announcements: Count
    duplicate_occurrences: Count
    conflicted_announcements: Count
    pending_announcements: Count
    unresolved_opponents: Count
    unresolved_start_time: Count
    results_known: Count
    canonical_linked: Count
    source_phases: tuple[Literal["past", "upcoming", "running"], ...]
    pages_per_phase: Annotated[int, Field(ge=1, le=10)]
    coverage_note: Text
    result_note: Text
    _arrays = field_validator("source_phases", mode="before")(array)


class Counts(Frozen):
    source_records: Count
    announcements: Count
    duplicate_occurrences: Count
    conflicted_announcements: Count
    pending_announcements: Count
    canonical_linked: Count
    sources: Annotated[int, Field(ge=3, le=30)]


class CalendarManifest(Frozen):
    schema_version: Literal["arena-provider-calendar-1.0"]
    provider: Literal["pandascore"]
    data_kind: Literal["api"]
    dataset_version: Hex16
    generated_at: Stamp
    as_of: Stamp
    source_scope: PublicationScope
    counts: Counts
    files: dict[str, Hex64]
    publication_note: Text
    _clocks = field_validator("generated_at", "as_of")(stamp)


@dataclass(frozen=True)
class CalendarDataset:
    manifest: MappingProxyType
    calendar_fingerprint: str
    facts_version: str
    announcements: tuple[Announcement, ...]
    occurrences: tuple[Occurrence, ...]
    sources: tuple[Source, ...]
    quality: Quality
    by_id: MappingProxyType


def _business(row):
    return {key: row.model_dump(mode="json")[key] for key in Business.model_fields}


def _validate_business(row):
    if int(row.announcement_id.split(":")[1]) > 2**53 - 1:
        raise PairError("calendar_identity_mismatch")
    text_values = [row.name]
    text_values.extend(team.team_name for team in (row.team_a, row.team_b) if team)
    for kind in ("league", "series", "tournament"):
        metadata = getattr(row, kind)
        if metadata:
            text_values.extend((metadata.name, metadata.full_name, metadata.season))
    if any(value is not None and not value.strip() for value in text_values):
        raise PairError("calendar_derivation_mismatch")
    pending = set()
    teams = (row.team_a, row.team_b)
    ids = [team.team_id if team else None for team in teams]
    for team in teams:
        if team and team.team_id != (f"pandascore:{team.source_team_id}" if team.source_team_id else None):
            raise PairError("calendar_identity_mismatch")
    if None in ids or len(set(ids)) != 2:
        pending.add("unresolved_opponents")
    if any(team and team.team_name is None for team in teams):
        pending.add("unresolved_team_names")
    if "unsupported_opponent_type" in row.pending_reasons:
        pending.add("unsupported_opponent_type")
    start = None
    begin = row.source_dates.begin_at
    if begin is not None:
        try:
            start = stamp(begin)
        except ValueError:
            if "T" in begin or " " in begin:
                pending.add("start_time_timezone_unknown")
    if start is None:
        pending.add("unresolved_start_time")
    for kind in ("league", "series", "tournament"):
        metadata = getattr(row, kind)
        if metadata and metadata.id != (f"pandascore:{kind}:{metadata.source_id}" if metadata.source_id else None):
            raise PairError("calendar_identity_mismatch")
    for result in row.source_results:
        if result.team_id != (f"pandascore:{result.source_team_id}" if result.source_team_id else None):
            raise PairError("calendar_identity_mismatch")
    known = (row.source_status == "finished" and None not in ids and len(set(ids)) == 2
             and len(row.source_results) == 2 and {r.team_id for r in row.source_results} == set(ids)
             and all(r.score is not None for r in row.source_results))
    if row.source_status == "finished" and not known:
        pending.add("result_unavailable")
    if row.source_status not in ("not_started", "running", "finished", "canceled", "postponed"):
        pending.add("unknown_status")
    if row.start_time != start or row.result_known != known or set(row.pending_reasons) != pending:
        raise PairError("calendar_derivation_mismatch")


def load_calendar(directory, descriptor, now, *, canonical_ids=()):
    """Read each bounded verified file once and retain only immutable objects."""
    directory = Path(directory)
    safe(directory)
    if (directory.name != descriptor.basename
            or re.fullmatch(r"calendar-" + re.escape(descriptor.dataset_version), descriptor.basename) is None):
        raise PairError("calendar_descriptor_mismatch")
    entries = []
    for entry in directory.iterdir():
        if len(entries) == 5:
            raise PairError("calendar_inventory_mismatch")
        safe(entry)
        if not stat.S_ISREG(entry.stat().st_mode):
            raise PairError("calendar_inventory_mismatch")
        entries.append(entry.name)
    if set(entries) != {"manifest.json", *CALENDAR_FILES}:
        raise PairError("calendar_inventory_mismatch")
    raw_manifest = read_bytes(directory / "manifest.json", 64 * 1024)
    if hashlib.sha256(raw_manifest).hexdigest() != descriptor.manifest_sha256:
        raise PairError("calendar_manifest_mismatch")
    try:
        raw = parse_json(raw_manifest)
        manifest = CalendarManifest.model_validate(raw)
        if manifest.model_dump(mode="json") != raw:
            raise PairError("noncanonical_calendar_fields")
        if set(manifest.files) != set(CALENDAR_FILES) or manifest.dataset_version != descriptor.dataset_version:
            raise PairError("calendar_manifest_mismatch")
        if not utc(manifest.as_of) <= utc(manifest.generated_at) <= now:
            raise PairError("future_timestamp")
        payload = {}
        for name in CALENDAR_FILES:
            body = read_bytes(directory / name, MAX_FILE_BYTES)
            if hashlib.sha256(body).hexdigest() != manifest.files[name]:
                raise PairError("calendar_checksum_mismatch")
            payload[name.removesuffix(".json")] = parse_json(body)
        models = {}
        for key, model, bound in (("announcements", Announcement, MAX_RECORDS),
                                  ("occurrences", Occurrence, MAX_RECORDS), ("sources", Source, 30)):
            rows = payload[key]
            if not isinstance(rows, list) or len(rows) > bound:
                raise PairError("calendar_size_limit")
            models[key] = tuple(model.model_validate(row) for row in rows)
            if [row.model_dump(mode="json") for row in models[key]] != rows:
                raise PairError("noncanonical_calendar_fields")
        quality = Quality.model_validate(payload["quality"])
        if quality.model_dump(mode="json") != payload["quality"]:
            raise PairError("noncanonical_calendar_fields")
    except (ValueError, TypeError, KeyError) as error:
        if isinstance(error, PairError):
            raise
        raise PairError("invalid_calendar_contract") from None
    announcements, occurrences, sources = (models[key] for key in ("announcements", "occurrences", "sources"))
    pages = quality.pages_per_phase
    expected_sources = [f"pandascore:valorant:{phase}:page:{page}" for page in range(1, pages + 1) for phase in PHASES]
    if [s.source_id for s in sources] != expected_sources or manifest.source_scope.model_dump(mode="json") != dict(
            kind="match_phases", competition_codes=[], phases=list(PHASES), pages=pages):
        raise PairError("calendar_scope_mismatch")
    if len({s.requested_at for s in sources}) != 1:
        raise PairError("calendar_collection_mismatch")
    source_map = {s.source_id: s for s in sources}
    for source in sources:
        if (source.source_id != f"pandascore:valorant:{source.phase}:page:{source.page}"
                or source.endpoint != f"valorant/matches/{source.phase}?page={source.page}&per_page=100"
                or source.requested_at > source.observed_at or utc(source.observed_at) > now):
            raise PairError("calendar_provenance_mismatch")
    if tuple(sorted(occurrences, key=lambda r: r.occurrence_id)) != occurrences or len({r.occurrence_id for r in occurrences}) != len(occurrences):
        raise PairError("calendar_occurrence_mismatch")
    source_rows = {key: [] for key in source_map}
    groups = {}
    for row in occurrences:
        source = source_map.get(row.source_id)
        if source is None or source.observed_at != row.observed_at:
            raise PairError("calendar_occurrence_mismatch")
        source_rows[row.source_id].append(row.occurrence_id)
        _validate_business(row)
        groups.setdefault(row.announcement_id, []).append(row)
    for source in sources:
        if set(source_rows[source.source_id]) != {f"{source.source_id}:row:{i:03d}" for i in range(source.record_count)}:
            raise PairError("calendar_occurrence_mismatch")
    if [row.announcement_id for row in announcements] != sorted(groups):
        raise PairError("calendar_aggregation_mismatch")
    canonical_ids = frozenset(canonical_ids)
    for row in announcements:
        variants = groups[row.announcement_id]
        fields = [_business(item) for item in variants]
        conflicted = len({canonical(item) for item in fields}) > 1
        selected = max(variants, key=lambda item: (item.observed_at, item.occurrence_id))
        selected_business = _business(selected)
        known_at = min(item.observed_at for item, business in zip(variants, fields, strict=True)
                       if business == selected_business)
        if conflicted:
            selected_business["pending_reasons"] = sorted(set(selected_business["pending_reasons"]) | {"conflicting_phase_records"})
            selected_business["result_known"] = False
        if (row.canonical_match_id is not None and (row.canonical_match_id != row.announcement_id
                or row.canonical_match_id not in canonical_ids or conflicted)):
            raise PairError("calendar_canonical_link_mismatch")
        expected = dict(**selected_business, canonical_match_id=row.canonical_match_id, observed_at=known_at,
                        first_observed_at=min(item.observed_at for item in variants),
                        last_observed_at=max(item.observed_at for item in variants),
                        source_ids=sorted({item.source_id for item in variants}),
                        occurrence_ids=sorted(item.occurrence_id for item in variants), conflicted=conflicted)
        if row.model_dump(mode="json") != expected:
            raise PairError("calendar_aggregation_mismatch")
    measured = dict(source_records=len(occurrences), announcements=len(announcements),
                    duplicate_occurrences=len(occurrences)-len(announcements),
                    conflicted_announcements=sum(r.conflicted for r in announcements),
                    pending_announcements=sum(bool(r.pending_reasons) for r in announcements),
                    unresolved_opponents=sum("unresolved_opponents" in r.pending_reasons for r in announcements),
                    unresolved_start_time=sum("unresolved_start_time" in r.pending_reasons for r in announcements),
                    results_known=sum(r.result_known for r in announcements),
                    canonical_linked=sum(r.canonical_match_id is not None for r in announcements))
    if any(getattr(quality, key) != value for key, value in measured.items()) or quality.source_phases != PHASES:
        raise PairError("calendar_counts_mismatch")
    expected_counts = {key: measured[key] for key in Counts.model_fields if key != "sources"} | {"sources": len(sources)}
    if manifest.counts.model_dump() != expected_counts:
        raise PairError("calendar_counts_mismatch")
    if manifest.as_of != max(s.observed_at for s in sources):
        raise PairError("calendar_clock_mismatch")
    if hashlib.sha256(canonical(payload)).hexdigest()[:16] != manifest.dataset_version:
        raise PairError("calendar_version_mismatch")
    # The producer's fixed notes explain bounded coverage and series-score scope.
    if quality.coverage_note != "Bounded provider pages from one completed poll; not a complete event calendar or in-game feed." or quality.result_note != "Scores are source-reported series results. Upcoming zero scores remain unconfirmed; no rounds inferred.":
        raise PairError("calendar_quality_scope_mismatch")
    facts = [dict(**_business(row), canonical_match_id=row.canonical_match_id, conflicted=row.conflicted) for row in announcements]
    return CalendarDataset(freeze(raw), hashlib.sha256(canonical(dict(manifest=raw, **payload))).hexdigest(),
                           hashlib.sha256(canonical(facts)).hexdigest(), announcements, occurrences, sources,
                           quality, MappingProxyType({row.announcement_id: row for row in announcements}))
