# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.4.0 - 2026-10-28 - how full each one got

- Each ledger row gains `context`: the last step's prompt (input + cache read + cache creation), the size of the subagent's context when it ended. `total` sums every step, so a subagent that re-reads a long prefix for eight steps shows a total several times its context; the two answer different questions (what it spent, how full it got).
- The pane row adds it: `8 turns  41k (out 2104, ctx 24k)`. `report` prints a `context` column; rows from earlier versions show `-`.
- The by-hand hook writes the same field from the transcript's newest step.
- Tests: the module tests and the fixture check the field; against 0.3.1 they fail 3 and 1.
- Minor, not patch: a new field in the ledger rows.

## 0.3.1 - 2026-10-28 - the front desk tells the truth

- CLAUDE.md described the 0.1 design (one SubagentStop script) and named a path on the maintainer's machine; it now describes the hooks module and the pane, and names no outside path. No code change.

## 0.3.0 - 2026-10-28 - a pane

- A side pane, "Subagent spend", lists every subagent of the session, biggest spender first: type, the first six characters of its id, turns, total tokens, output tokens, model. It redraws on each subagent step.
- The pane opens by itself at the first subagent a session starts, once; `/subagent-spend` opens it at any time and answers with the running total. A surface that seats no panes is left alone; the ledger and status line go on.
- The module is now `hooks/register.tsx` with a state contract in `types/index.d.ts`; the ledger file, its rows and the status line are unchanged.
- Tests: 11 checks (was 7), the four new ones on the pane, the command, opening once, and a value an earlier version stored.
- Minor, not patch: the module draws now and registers a command.

## 0.2.0 - 2026-10-27 - hooks module

- The plugin is now a hooks module (`hooks/register.ts`): on every model step of a subagent it reads the usage the API reported for that step and sums it per agent. Live per step, not at the subagent's end, and no transcript is read.
- The ledger file and its rows are unchanged (`~/.subagent-spend/<session_id>.jsonl`, one JSON row per agent; `SUBAGENT_SPEND_DIR` overrides the folder), so `subagent_spend.py report` and `subagent_spend.py statusline` read it as before. The module rewrites the file whole after each step instead of appending.
- The running total is also put in the status line by the module itself (`subagents 2 | tok 7340 (out 120)`).
- A ledger that cannot be written is named once in the status line; the session goes on.
- The `SubagentStop` command hook is no longer registered by the plugin; it stays as the by-hand install in `kit/settings-snippet.json` for a Claude Code that loads no hooks modules. Install one of the two, not both, or every agent is counted twice.
- Tests: `hooks/register.test.ts` (6 checks under `claude plugin test`) beside the fixture test; `tests/release.sh` runs validate, both test sets and the version check, and is the release gate.
- Minor, not patch: which hook the plugin registers changed.

## 0.1.1 - 2026-10-27

- Readers keep one row per `agent_id` (the last write wins), so a repeated `SubagentStop` for one agent is counted once.
- Plugin and marketplace manifests, `hooks/hooks.json`, an icon; the one-line install.
- Release gate: `nightlab-release.json` names the fixture test.

## 0.1.0 - 2026-10-27

- First version: `SubagentStop` command hook summing a subagent's transcript, statusline, report, fixture test.
