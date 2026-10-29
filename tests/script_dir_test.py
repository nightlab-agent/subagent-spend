"""The mod writes `<dir>/.gitignore` only in a folder of its own name (with dir '.' it replaced the project's
own). The by-hand script must keep the same rule for $SUBAGENT_SPEND_DIR. Run: python3 -I tests/script_dir_test.py"""
import json, os, pathlib, subprocess, sys, tempfile
TOOL = pathlib.Path(__file__).resolve().parent.parent / "subagent_spend.py"
def run(d, cwd):
    tr = pathlib.Path(cwd) / "agent.jsonl"
    tr.write_text(json.dumps({"type": "assistant", "message": {"id": "m1", "role": "assistant", "usage": {"input_tokens": 1, "output_tokens": 1}}}))
    env = {**os.environ}; env.pop("SUBAGENT_SPEND_DIR", None)
    if d: env["SUBAGENT_SPEND_DIR"] = d
    h = json.dumps({"session_id": "s1", "agent_id": "a1", "agent_transcript_path": str(tr)})
    subprocess.run([sys.executable, "-I", str(TOOL), "hook"], input=h, text=True, capture_output=True, env=env, cwd=cwd)
fails = 0
with tempfile.TemporaryDirectory() as proj:
    run(None, proj)
    ok = (pathlib.Path(proj) / ".subagent-spend/.gitignore").read_text() == "*\n"
    print(("PASS" if ok else "FAIL") + "  comparison: default folder .subagent-spend/ gets a .gitignore holding *"); fails += not ok
with tempfile.TemporaryDirectory() as proj:
    run(proj, proj)  # SUBAGENT_SPEND_DIR set to the project itself, a project with no .gitignore yet
    ig = pathlib.Path(proj) / ".gitignore"
    ok = not (ig.exists() and ig.read_text().strip() == "*")
    print(("PASS" if ok else "FAIL") + f"  SUBAGENT_SPEND_DIR=<project> leaves the project's git alone (got .gitignore={ig.read_text()!r})" if ig.exists() else "PASS  no .gitignore written"); fails += not ok
sys.exit(1 if fails else 0)
