"""Synthetic transcript test: no Claude session needed. Run: python3 -I tests/fixture_test.py"""
import json, os, subprocess, sys, tempfile, pathlib
HERE = pathlib.Path(__file__).resolve().parent; TOOL = HERE.parent / "subagent_spend.py"
with tempfile.TemporaryDirectory() as d:
    env = {**os.environ, "SUBAGENT_SPEND_DIR": d}
    (pathlib.Path(d) / "tr").mkdir(); tr = pathlib.Path(d) / "tr" / "agent.jsonl"
    u = lambda i, o, cr, cc: {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": cr, "cache_creation_input_tokens": cc}
    lines = [{"type": "user", "message": {"role": "user", "content": "x"}},
             {"type": "assistant", "uuid": "a", "message": {"id": "m1", "role": "assistant", "model": "claude-opus-5-5", "usage": u(100, 5, 0, 0)}},
             {"type": "assistant", "uuid": "b", "message": {"id": "m1", "role": "assistant", "model": "claude-opus-5-5", "usage": u(100, 40, 0, 0)}},
             {"type": "assistant", "uuid": "c", "message": {"id": "m2", "role": "assistant", "model": "claude-opus-5-5", "usage": u(10, 20, 3000, 500)}},
             "not json"]
    tr.write_text("\n".join(json.dumps(l) if not isinstance(l, str) else l for l in lines))
    h = json.dumps({"session_id": "sess1", "hook_event_name": "SubagentStop", "agent_id": "ag1", "agent_type": "Explore", "agent_transcript_path": str(tr)})
    r = subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input=h, text=True, capture_output=True, env=env); assert r.returncode == 0, r.stderr
    subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input=h, text=True, capture_output=True, env=env)
    rows = [json.loads(l) for l in (pathlib.Path(d) / "sess1.jsonl").read_text().splitlines()]
    assert len(rows) == 2 and rows[0]["turns"] == 2 and rows[0]["input"] == 110 and rows[0]["output"] == 60 and rows[0]["cache_read"] == 3000 and rows[0]["total"] == 3670, rows
    s = subprocess.run([sys.executable, "-I", str(TOOL), "statusline"], input=json.dumps({"session_id": "sess1", "model": {"display_name": "Opus"}}), text=True, capture_output=True, env=env)
    assert s.stdout.strip() == "Opus | subagents 2 | tok 7340 (out 120)", s.stdout
    bad = subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input="{not json", text=True, capture_output=True, env=env); assert bad.returncode == 0
    rep = subprocess.run([sys.executable, "-I", str(TOOL), "report", "--all"], text=True, capture_output=True, env=env); assert "Explore" in rep.stdout
    print("fixture test: 5 checks passed"); print(s.stdout.strip()); print(rep.stdout)
