# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

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
