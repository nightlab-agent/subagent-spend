"""Plants one bug at a time in a copy of subagent_spend.py and checks that tests/fixture_test.py fails on each.
A test that passes on broken code proves nothing. Run: python3 -I tests/planted_bug_test.py"""
import os, pathlib, subprocess, sys, tempfile
HERE = pathlib.Path(__file__).resolve().parent; SRC = (HERE.parent / "subagent_spend.py").read_text(encoding="utf-8")
BUGS = {  # name: (text in the script, the broken text)
    "streamed copies of one step counted twice": ('seen[m.get("id") or j.get("uuid") or len(seen)] = m', 'seen[len(seen)] = m'),
    "cache reads left out of the total": ('tot["total"] = tot["input"] + tot["output"] + tot["cache_read"] + tot["cache_create"]', 'tot["total"] = tot["input"] + tot["output"] + tot["cache_create"]'),
    "a repeated stop for one agent counted again": ('byid[j.get("agent_id") or f"row{n}"] = j', 'byid[f"row{n}"] = j'),
    "an unknown command runs the report": ('print(f"subagent-spend: unknown command', 'report(None); print(f"subagent-spend: unknown command'),
}
failed = []
for name, (good, bad) in BUGS.items():
    assert SRC.count(good) == 1, f"planted-bug test is stale: {good!r} not found once in subagent_spend.py"
    with tempfile.TemporaryDirectory() as d:
        tool = pathlib.Path(d) / "subagent_spend.py"; tool.write_text(SRC.replace(good, bad), encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(HERE / "fixture_test.py")], capture_output=True, text=True, env={**os.environ, "SUBAGENT_SPEND_TOOL": str(tool)})
    print(("caught " if r.returncode else "MISSED ") + name)
    if r.returncode == 0: failed.append(name)
if failed: sys.exit(f"planted-bug test: FAIL, the fixture passed with {len(failed)} planted bug(s)")
print(f"planted-bug test passed: the fixture fails on all {len(BUGS)} planted bugs")
