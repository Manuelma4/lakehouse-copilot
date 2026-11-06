"""Record bounded actual-inference research examples, separately from semantic evaluation."""

import argparse
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import httpx

from arena_copilot.agent import Copilot
from arena_copilot.openfootball import OpenFootballResearch, default_research
from arena_copilot.research_agent import ResearchCopilot
from arena_copilot.snapshot import default_fixture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=default_research())
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("data/research-model-smoke"))
    parser.add_argument("--case", action="append", choices=("final-score-stages", "source-date-utc-rollover",
                        "mexico-imported-coverage"), help="Run only the selected case(s)")
    args = parser.parse_args()
    research = OpenFootballResearch(args.package)
    records = research.payload["matches"]
    final = next(row for row in records if row["edition_id"] == "worldcup-2026"
                 and row["source_match_number"] == 104)
    rollover = next(row for row in records if row["edition_id"] == "worldcup-2026"
                    and row["source_date"] == "2026-06-11" and "South Korea" in (row["team_a"], row["team_b"]))
    mexico = next(team for team in research.team_profiles.values() if team["team_name"] == "Mexico")
    cases = [
        dict(id="final-score-stages", question="What are the source FT and extra-time score stages for this match? "
             "Keep them separate and identify the source sides.",
             context=dict(match_id=final["match_id"]),
             reference=dict(teams=[final["team_a"], final["team_b"]], stages=json.loads(final["score_details_json"]),
                            prediction_eligible=False)),
        dict(id="source-date-utc-rollover", question="What is the original source date and local kickoff, "
             "and what is the offset-derived UTC kickoff for this match? Explain the date rollover.",
             context=dict(match_id=rollover["match_id"]), reference={key: rollover[key] for key in
                 ("source_date", "local_time", "utc_offset_minutes", "start_time", "timezone", "completed_at")}),
        dict(id="mexico-imported-coverage", question="How many imported records and observed and unknown results "
             "does this team have? Is this its complete official performance record?",
             context=dict(team_id=mexico["team_id"]), reference={key: mexico[key] for key in
                 ("team_name", "record_count", "observed_results", "unknown_results", "coverage_note")}),
    ]
    if args.case:
        cases = [case for case in cases if case["id"] in args.case]
    report = dict(recorded_at=datetime.now(timezone.utc).isoformat(), platform=platform.platform(),
        scope=f"{len(cases)} actual local research inference example(s); integration checks, not a human-reviewed scorecard",
        dataset_version=research.manifest["dataset_version"], snapshot_fingerprint=research.fingerprint,
        configuration=dict(temperature=0, context_tokens=4096, thinking=False, concurrent_requests=1),
        cases=[], status="running")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    save()
    model = Copilot(default_fixture(), args.state / "model")
    agent = ResearchCopilot(research, model, args.state / "research")
    try:
        models = httpx.get(model.base_url.rstrip("/") + "/api/tags", timeout=15).json()["models"]
        digest = next(item["digest"] for item in models if item["name"] == model.model)
        report["model"] = model.model
        report["model_digest_before"] = digest
        save()
        for case in cases:
            entry = dict(**case, status="failed")
            try:
                response = agent.ask(case["question"], mode="ollama", **case["context"])
                passed = (not response["abstained"] and bool(response["citations"])
                          and response["metrics"]["generated_tokens"] > 0
                          and response["model_digest"] in (None, digest)
                          and response["dataset_version"] == report["dataset_version"]
                          and response["snapshot_fingerprint"] == report["snapshot_fingerprint"])
                entry.update(status="passed" if passed else "failed", response=response)
            except Exception as error:
                entry.update(error_type=type(error).__name__, error=str(error))
            report["cases"].append(entry)
            save()
            print(json.dumps(dict(case=case["id"], status=entry["status"],
                                  answer=entry.get("response", {}).get("answer")), ensure_ascii=False), flush=True)
        models = httpx.get(model.base_url.rstrip("/") + "/api/tags", timeout=15).json()["models"]
        report["model_digest_after"] = next(item["digest"] for item in models if item["name"] == model.model)
    except Exception as error:
        report.update(status="failed", error_type=type(error).__name__, error=str(error),
                      semantic_review="Not evaluated; inference metadata or service failed")
        save()
        print(json.dumps(dict(status="failed", error_type=type(error).__name__)), flush=True)
        return 1
    finally:
        agent.close()
        model.close()
    report["status"] = "passed" if (all(case["status"] == "passed" for case in report["cases"])
        and report["model_digest_before"] == report["model_digest_after"]) else "failed"
    report["digest_scope"] = "Installed model captured before/after; per-response digest is best-effort and may be null"
    report["semantic_review"] = "Pending; citation membership does not establish factual support"
    save()
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
