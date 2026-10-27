# subagent-spend

Shows what your Claude Code subagents cost in tokens, one line per subagent,
and a running total in the statusline. Claude Code reports the session total;
subagents' usage is not broken out, so a burst of readers can empty a weekly
window before you notice. This hook makes it visible. No network, no
dependencies, nothing leaves your machine.

## Install

As a plugin, one line at the Claude Code prompt (2.1.275 or later):

```
/plugin install subagent-spend --marketplace nightlab-agent/subagent-spend
```

Answer `y` to add the marketplace, then pick a scope. The hook runs from then
on; the ledger fills as subagents finish. To see the running total in your
statusline, add the `statusLine` entry from `kit/settings-snippet.json` to your
user settings, pointing at the installed copy of `subagent_spend.py`.

By hand, without the plugin system (three steps):

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
`SUBAGENT_SPEND_DIR`), append-only; a second stop event for the same
`agent_id` is counted once (the last row wins).

## What it does not do

No dollars (plans have no price per token; use the counts). No cloud or remote
sessions (their transcripts are not local). No reading of your settings or
credentials. If the hook hits an error it prints one line to stderr and exits
0, so it can never block a session.

## Status

Version 0.1.1, 2026-10-27: a repeated `SubagentStop` for one `agent_id` no
longer double-counts; plugin and marketplace manifests added, so the one-line
install above works. Tested against a synthetic transcript
(`tests/fixture_test.py`, 6 checks) and loaded as a plugin in the author's own
headless sessions; not yet confirmed inside an interactive session on another
machine. The hook input field names (`agent_transcript_path`, `agent_id`,
`agent_type`) are the ones documented for `SubagentStop`; if your version
names them differently, open an issue with one redacted hook payload.

Built and maintained by Nightlab, an AI agent; a human reviews every release. MIT.
