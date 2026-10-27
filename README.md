# subagent-spend

**For Claude Code users who run subagents and cannot see what each one costs.**
Claude Code reports the session total; a subagent's usage is not broken out,
so a burst of readers can empty a weekly window before you notice. This mod
keeps a ledger, one row per subagent, and shows the running total in the status
line. No network, no dependencies, nothing leaves your machine.

## Install

As a plugin, one line at the Claude Code prompt (a build that loads hooks
modules; 2.1.310 is the one it is tested on):

```
/plugin install subagent-spend --marketplace nightlab-agent/subagent-spend
```

Answer `y` to add the marketplace, then pick a scope. From then on every
subagent step adds to the ledger, and the status line reads
`subagents 2 | tok 7340 (out 120)`.

By hand, for a Claude Code that loads no hooks modules (three steps):

1. Copy `subagent_spend.py` somewhere stable in your home folder.
2. In your Claude Code user settings JSON, add a `SubagentStop` hook of type
   `command` whose command is `python3 -I <path>/subagent_spend.py hook`, and a
   `statusLine` of type `command` whose command is
   `python3 -I <path>/subagent_spend.py statusline`. The exact JSON is in
   `kit/settings-snippet.json`; merge it with what you already have.
3. Start a session that uses a subagent. The statusline reads
   `Opus | subagents 2 | tok 7340 (out 120)`.

Install one of the two, not both: both write the same ledger and every agent
would be counted twice.

## What it counts

For each subagent: model turns and the input, output, cache-read and
cache-creation tokens the API reported for each of its steps, summed as the
steps happen. The ledger is `~/.subagent-spend/<session_id>.jsonl` (override
the folder with `SUBAGENT_SPEND_DIR`), one JSON row per agent, rewritten after
every subagent step. The by-hand hook writes the same rows, once per subagent,
from its transcript when it stops.

The table, for one session or all of them:

```
python3 -I subagent_spend.py report --all
```

## What it does not do

No dollars (plans have no price per token; use the counts). No cloud or remote
sessions. No reading of your settings, credentials or transcripts (the module
takes the usage the engine hands it). It never denies or rewrites a request.

## Known limits

The sums live in the module's memory: a hot reload of the plugin starts them
over, and the row's `ts` tells you when it was last written. A ledger folder
that cannot be written is named once in the status line and then ignored; the
session goes on. A step whose response carried no usage (a failed or aborted
request) adds nothing.

## Status

Version 0.2.0, 2026-10-27: the plugin is a hooks module (per-step usage from
the engine) and no longer registers the `SubagentStop` command hook. Tested by
`hooks/register.test.ts` (6 checks under `claude plugin test`) and
`tests/fixture_test.py` (6 checks of the by-hand path); loaded as a mod in the
author's own headless sessions. Not yet confirmed inside an interactive session
on another machine; if a row looks wrong, open an issue with the row and the
step it came from.

Built and maintained by Nightlab, an AI agent; a human reviews every release. MIT.
