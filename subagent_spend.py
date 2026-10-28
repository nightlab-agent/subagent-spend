#!/usr/bin/env python3
"""subagent-spend 0.4.1: attribute Claude Code token usage to each subagent.

  subagent_spend.py hook        SubagentStop hook: reads the hook JSON on stdin, sums the usage
                                in the subagent transcript, appends one line to the session ledger.
  subagent_spend.py statusline  statusline command: reads the statusline JSON on stdin, prints
                                "<model> | subagents N | tok T (out O)".
  subagent_spend.py report [SESSION_ID | --all]
                                table of subagents, tokens and turns, from the ledger.

Ledger: $SUBAGENT_SPEND_DIR or ~/.subagent-spend/<session_id>.jsonl, append-only; readers keep the last
row per agent_id. No network, no dependencies,
nothing read outside the transcript path the hook names. The hook always exits 0 so a bug here can
never stop a session.
"""
import json, os, sys, pathlib, datetime

def ledger_dir():
    d = pathlib.Path(os.environ.get("SUBAGENT_SPEND_DIR") or pathlib.Path.home() / ".subagent-spend")
    d.mkdir(parents=True, exist_ok=True); return d

def sum_transcript(path):
    """Sum usage over assistant messages; one message id counted once (streaming writes it more than once)."""
    tot = {"input": 0, "output": 0, "cache_read": 0, "cache_create": 0, "turns": 0}; seen = {}; model = ""
    for line in pathlib.Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        try: j = json.loads(line)
        except ValueError: continue
        m = j.get("message") if isinstance(j, dict) else None
        if not isinstance(m, dict) or m.get("role") != "assistant" or "usage" not in m: continue
        seen[m.get("id") or j.get("uuid") or len(seen)] = m  # last write for an id wins
        model = m.get("model") or model
    for m in seen.values():
        u = m["usage"]; tot["turns"] += 1
        tot["input"] += u.get("input_tokens", 0) or 0; tot["output"] += u.get("output_tokens", 0) or 0
        tot["cache_read"] += u.get("cache_read_input_tokens", 0) or 0; tot["cache_create"] += u.get("cache_creation_input_tokens", 0) or 0
    tot["total"] = tot["input"] + tot["output"] + tot["cache_read"] + tot["cache_create"]; tot["model"] = model
    last = list(seen.values())[-1]["usage"] if seen else {}  # the newest step: its prompt and reply are the context the agent ended on
    tot["context"] = sum(last.get(k, 0) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"))
    return tot

def hook():
    try:
        h = json.load(sys.stdin)
        path = h.get("agent_transcript_path")
        if not path or not pathlib.Path(path).exists(): return 0
        t = sum_transcript(path)
        row = {"ts": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "session_id": h.get("session_id", "unknown"),
               "agent_id": h.get("agent_id"), "agent_type": h.get("agent_type") or h.get("subagent_type") or "", **t}
        with open(ledger_dir() / f"{row['session_id']}.jsonl", "a", encoding="utf-8") as f: f.write(json.dumps(row) + "\n")
    except Exception as e:  # never block the session
        sys.stderr.write(f"subagent-spend: {e}\n")
    return 0

def rows_for(session_id):
    p = ledger_dir() / f"{session_id}.jsonl"
    if not p.exists(): return []
    byid = {}  # one row per agent_id, the last write wins (a second SubagentStop for the same agent repeats it)
    for n, l in enumerate(p.read_text(encoding="utf-8").splitlines()):
        try: j = json.loads(l)
        except ValueError: continue
        if isinstance(j, dict) and "total" in j: byid[j.get("agent_id") or f"row{n}"] = j
    return list(byid.values())

def fmt(n): return f"{n/1000:.0f}k" if n >= 10000 else str(n)

def statusline():
    try:
        s = json.load(sys.stdin); rows = rows_for(s.get("session_id", ""))
        model = (s.get("model") or {}).get("display_name") or ""
        tok = sum(r["total"] for r in rows); out = sum(r["output"] for r in rows)
        print(f"{model} | subagents {len(rows)} | tok {fmt(tok)} (out {fmt(out)})")
    except Exception as e: print(f"subagent-spend: {e}")
    return 0

def report(arg):
    files = sorted(ledger_dir().glob("*.jsonl")) if arg in (None, "--all") else [ledger_dir() / f"{arg}.jsonl"]
    print(f"{'session':12} {'agent_type':18} {'turns':>5} {'input':>9} {'cache_rd':>9} {'cache_cr':>9} {'output':>8} {'total':>9} {'context':>8}  ts")
    for f in files:
        for r in rows_for(f.stem):
            print(f"{r['session_id'][:12]:12} {(r.get('agent_type') or '-')[:18]:18} {r['turns']:>5} {r['input']:>9} {r['cache_read']:>9} {r['cache_create']:>9} {r['output']:>8} {r['total']:>9} {r.get('context', '-'):>8}  {r['ts']}")
    return 0

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "hook"
    sys.exit({"hook": hook, "statusline": statusline}.get(cmd, lambda: report(sys.argv[2] if len(sys.argv) > 2 else None))())
