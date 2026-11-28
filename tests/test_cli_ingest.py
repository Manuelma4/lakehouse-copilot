from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

from arena_copilot import cli
from arena_copilot.snapshot import default_fixture, validate_snapshot


def test_simultaneous_imports_publish_only_validated_copies(tmp_path, monkeypatch):
    state = tmp_path / "state"
    active = state / "ACTIVE"
    waiting = Barrier(2, timeout=10)
    replace = Path.replace

    def wait_at_publication(path, target):
        if target == active:
            waiting.wait()
        return replace(path, target)

    monkeypatch.setenv("ARENA_STATE", str(state))
    monkeypatch.setattr(Path, "replace", wait_at_publication)
    args = ["--state", str(state), "ingest", str(default_fixture())]
    with ThreadPoolExecutor(max_workers=2) as pool:
        imports = [pool.submit(cli.main, args) for _ in range(2)]
        for request in imports:
            request.result(timeout=15)

    copies = set((state / "snapshots").iterdir())
    assert len(copies) == 2
    assert Path(active.read_text(encoding="utf-8")) in copies
    assert set(state.iterdir()) == {active, state / "snapshots"}
    for copy in copies:
        validate_snapshot(copy)
