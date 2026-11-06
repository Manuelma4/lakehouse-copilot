import argparse
import json
import os
import shutil
import uuid
from pathlib import Path

from dotenv import load_dotenv

from .agent import Copilot
from .snapshot import default_fixture, validate_snapshot


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Arena evidence-based sports copilot")
    parser.add_argument("--snapshot", type=Path, default=Path(os.environ.get("ARENA_SNAPSHOT") or default_fixture()))
    parser.add_argument("--state", type=Path, default=Path(os.environ.get("ARENA_STATE", "data/copilot")))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    sub.add_parser("index")
    ask = sub.add_parser("ask")
    ask.add_argument("question")
    ask.add_argument("--mode", choices=["evidence", "ollama"], default="ollama")
    ask.add_argument("--retrieval", choices=["lexical", "hybrid"], default="lexical")
    ingest = sub.add_parser("ingest")
    ingest.add_argument("source", type=Path)
    sub.add_parser("serve")
    args = parser.parse_args()
    if args.command == "validate":
        print(json.dumps(validate_snapshot(args.snapshot), indent=2))
    elif args.command == "ingest":
        validate_snapshot(args.source)
        destination = args.state / "snapshots" / uuid.uuid4().hex
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(args.source, destination)
        validate_snapshot(destination)
        pointer = args.state / "ACTIVE.tmp"
        pointer.write_text(str(destination.resolve()), encoding="utf-8")
        pointer.replace(args.state / "ACTIVE")
        print(f"Validated local copy: {destination.resolve()}\nSet ARENA_SNAPSHOT to this path to serve it.")
    elif args.command == "serve":
        import uvicorn
        os.environ["ARENA_SNAPSHOT"] = str(args.snapshot.resolve())
        os.environ["ARENA_STATE"] = str(args.state.resolve())
        uvicorn.run("arena_copilot.api:app", host="127.0.0.1", port=8000)
    else:
        agent = Copilot(args.snapshot, args.state)
        if args.command == "index":
            agent.retriever.build_vectors(agent.base_url, os.environ.get(
                "OLLAMA_EMBED_MODEL", "nomic-embed-text:137m-v1.5-fp16"))
            print("Local 768-dimensional document embeddings verified and saved.")
        else:
            print(json.dumps(agent.ask(args.question, args.mode, retrieval=args.retrieval), indent=2))
        agent.close()


if __name__ == "__main__":
    main()
