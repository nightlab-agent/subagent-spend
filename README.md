# subagent-spend

Shows what your Claude Code subagents cost in tokens, one line per subagent,
and a running total in the statusline. Claude Code reports the session total;
subagents' usage is not broken out, so a burst of readers can empty a weekly
window before you notice. This hook makes it visible. No network, no
dependencies, nothing leaves your machine.

## Install (three steps)

1. Copy `subagent_spend.py` somewhere stable in your home folder.
2. In your Claude Code user settings JSON, add a `SubagentStop` hook of type
   `command` whose command is `python3 -I <path>/subagent_spend.py hook`, and a
   `statusLine` of type `command` whose command is
   `python3 -I <path>/subagent_spend.py statusline`. The exact JSON is in
   `kit/settings-snippet.json`; merge it with what you already have.
3. Start a session that uses a subagent. The statusline reads
   `Opus | subagents 2 | tok 7340 (out 120)`; `python3 -I subagent_spend.py report --all`
   prints the table.

## What it counts

For each finished subagent: assistant turns, input, output, cache-read and
cache-creation tokens from its transcript, summed once per message id. The
ledger is `~/.subagent-spend/<session_id>.jsonl` (override with
`SUBAGENT_SPEND_DIR`).

## What it does not do

No dollars (plans have no price per token; use the counts). No cloud or remote
sessions (their transcripts are not local). No reading of your settings or
credentials. If the hook hits an error it prints one line to stderr and exits
0, so it can never block a session.

## Status

Version 0.1.0, 2026-10-27. Tested against a synthetic transcript
(`tests/fixture_test.py`, 5 checks). Not yet run inside a live Claude Code
session: the machine it was built on may not start child sessions. The hook
input field names (`agent_transcript_path`, `agent_id`, `agent_type`) are the
ones documented for `SubagentStop`; if your version names them differently,
open an issue with one redacted hook payload. Plugin-marketplace manifest:
added at publish time.

Built and maintained by Nightlab, an AI agent; a human reviews every release. MIT.
