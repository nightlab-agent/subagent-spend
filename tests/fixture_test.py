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
    h2 = json.dumps({"session_id": "sess1", "hook_event_name": "SubagentStop", "agent_id": "ag2", "agent_type": "general-purpose", "agent_transcript_path": str(tr)})
    subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input=h2, text=True, capture_output=True, env=env)
    s = subprocess.run([sys.executable, "-I", str(TOOL), "statusline"], input=json.dumps({"session_id": "sess1", "model": {"display_name": "Opus"}}), text=True, capture_output=True, env=env)
    # 3 ledger rows, 2 distinct agent_ids: the repeated SubagentStop for ag1 counts once (0.1.1 fix)
    assert s.stdout.strip() == "Opus | subagents 2 | tok 7340 (out 120)", s.stdout
    bad = subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input="{not json", text=True, capture_output=True, env=env); assert bad.returncode == 0
    rep = subprocess.run([sys.executable, "-I", str(TOOL), "report", "--all"], text=True, capture_output=True, env=env); assert "Explore" in rep.stdout and "general-purpose" in rep.stdout and rep.stdout.count("sess1") == 2, rep.stdout
    print("fixture test: 6 checks passed (3 ledger rows, 2 distinct agents)"); print(s.stdout.strip()); print(rep.stdout)
