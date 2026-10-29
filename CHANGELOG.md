# Changelog

The form is Keep a Changelog; versions follow SemVer.

## 0.7.0 - 2026-10-29 - absorbs usage-file and turn-tally

Three separate mods (subagent-spend, usage-file, turn-tally) measured one session from three sides; one install now does all three. Minor, not patch: new
options, new files written and a new status line.

### Fixed
- Each `.gitignore` is written only in a folder of the mod's own name: with `dir` set to `.`, it replaced the
  project's own `.gitignore` with `*`. The by-hand script keeps the same rule for `SUBAGENT_SPEND_DIR`.
- After a `/clear` (a new session id with no new session start) the old session's subagents no longer land in the
  new session's rows file; `/subagent-spend` and the usage pane's one-time opening start over at the session's end,
  even when no subagent runs after it. A late answer naming the session just left does not switch back to it; a
  later resume into that session counts there again.
- On a host with no session id, a subagent step is still counted (rows file `no-session.jsonl`).
- A deleted folder came back in the same session without its `.gitignore`, so git saw the rows file: the
  `.gitignore` is now checked before every write.
- Tests for the `/clear` (old rows kept apart, the pane and the command starting over, a late session id, a
  resume), a deleted folder, a host with no session id, and the by-hand script's `.gitignore` rule; 57 module tests in all.

### Changed
- plugin.json and marketplace.json say the panes are not yet seen on a screen.
- README: Install comes right after the opening paragraph and names the Claude Code versions it needs
  (2.1.275 for `/plugin install --marketplace`, 2.1.292 for the shell form, from Claude Code's CHANGELOG); the
  notice is shown as a terminal drew it, with the `⚠ subagent-spend:` Claude Code puts in front; claude-hud's
  features are named from its README instead of left unchecked.
- `subagent_spend.py --help` prints the commands; an unknown command or extra arguments print them to stderr
  and exit 2 (before, they ran the report and created `.subagent-spend` in the current folder). Run bare from a
  terminal, it prints them instead of waiting on stdin.
- `tests/planted_bug_test.py`: the fixture test must fail on four planted bugs; `tests/release.sh` runs it.
- One notice under the prompt holds all three parts, subagent figures first: at 120 columns Claude Code cut a
  line that put them last after "tok 27" (seen in a terminal preview, 2026-10-29).
- One status line for the three parts, `subagents | usage | turns`, each piece as its mod showed it. Each status call
  sets the whole line, so three parts setting it in turn would have replaced each other.
- The pane shows an agent id by its first six characters, longer where two listed ids start the same; before, two
  agents whose ids shared six characters showed the same label.
- Every file is written one write at a time from the newest figures. turn-tally 0.4.0 could write an older step's
  message count over a newer one when its first write was slow; found by the new out-of-order test.
- README rewritten for the three parts.
- `tests/typecheck.sh` no longer falls back to a folder on the maintainer's machine. It uses `TSC` and `CC_TYPES`
  when set, else `npx --no-install tsc` or `tsc` on PATH, and the declarations Claude Code writes beside the mod
  (`.claude-plugin/types/claude-code/index.d.ts`); a missing one still fails, now with what to install.
- Notes in `CLAUDE.md`, `00-catalog/`, and `01-context/`, and this file, rewritten in plain words.

### Added
- The usage part, from usage-file 0.4.1, behind the `usageFile` option (default on): the rate-limit windows, context
  fill and cost in a Usage pane (`/usage-file`, or by itself once at 80 percent) and in `<usageFileDir>/latest.json`.
  The default folder is `.usage-file` and the file's format is unchanged, so a script that read usage-file's file
  keeps working.
- The turn counts, from turn-tally 0.4.0, behind the `turnTally` option (default on): main-conversation steps, tool
  calls, tool errors and error streak in `<turnTallyDir>/<YYYY-MM-DD>.txt`, same folder and lines as turn-tally
  but one: `tool calls 11 (subagents 30)` now reads `tool calls 11 (30 by subagents)` (in a terminal preview the
  old form was read as a count of subagents).
- Options `usageFileDir` and `turnTallyDir` (the two mods' `dir` options under new names; this mod's `dir` stays the
  subagent rows folder).
- Tests: the 14 of usage-file and the 6 of turn-tally, adapted; one per option turned off and its control; one for the combined status
  line; four for events that finish out of order, two subagents stepping while the main turn is open, and ids that look
  alike.
- A look-alike test for two agents of the same type: they stay two rows with their own counts (it fails if rows are
  keyed by type).
- README: a "Remove it" section (uninstall, and the folders and files to delete).

## 0.6.0 - 2026-10-29 - the folder is kept out of git

### Added
- Before its first write in a session the mod writes `<dir>/.gitignore` holding one line, `*`, so git ignores the
  folder in every project with no step from you (an outside review of the repo pointed it out, 2026-10-29).
- A test for it, which failed before the change. The by-hand script `subagent_spend.py` writes the same `.gitignore`
  when it makes the folder (checked by the fixture test).
- `docs/finding.md`: the subagent-token finding written up from every row recorded before 2026-10-29 01:10 (26
  subagents, 16 sessions), with the method, the three hand checks and what it does not say. The README's six-row table said "every row" when it was the first six
  measured; it now says so and points at the full set.

### Changed
- README rewritten in plain words: what it measures, how to install it, what it writes and how to delete it. It no
  longer carries a version history (this file does), and no longer advertises other products.

## 0.5.3 - 2026-10-28 - a README section on making your own mod

### Added
- README: a Build your own section pointing to a mod template (the section is gone since 0.7.0).

## 0.5.2 - 2026-10-28 - what the subagent figure leaves out

### Added
- README: "Measured", six live runs from the maintainer's own rows files comparing the `subagent_tokens` figure Claude Code prints with the tokens each subagent ran through (3.6 to 14.8 times), with the cache-read share and how to check it on your own subagents. No behaviour change.

### Changed
- The release check runs the plugin directory checklist (`tests/checklist.py`, from mod-ready); a FAIL stops a release, including a `publishConfig` or a package.json repository that is not the plugin's own GitHub repo.
- `tests/typecheck.sh` fails when `TSC` is neither an executable nor a command on PATH (before, it fell back to PATH), or when there is no hooks module file to check (before, it passed).

## 0.5.1 - 2026-10-28 - the release check type-checks

### Changed
- The release check type-checks the hooks module, its tests and the state contract with `tsc --noEmit` against the
  engine's own declarations (`tests/typecheck.sh`, the compiler options the declarations' header gives a hooks module).
  No `tsc` or no declarations fails the release check; it never skips.

### Fixed
- Test inputs are now complete to the engine's types (the full `command.run`, `agent.spawn` or `turn.step` shapes the tests left out). No behaviour change.

## 0.5.0 - 2026-10-28 - the rows folder is an option; the module reads no environment

### Changed
- The rows folder is the `dir` option (`userConfig`, set in `/config`), default `.subagent-spend` under the project the session runs in. It was `~/.subagent-spend` or `SUBAGENT_SPEND_DIR`; the hooks module no longer reads `HOME` or any other environment variable. To keep the old place, set `dir` to the absolute path of your old folder.
- `subagent_spend.py` (the by-hand hook and `report`) defaults to `.subagent-spend` under the current folder; `SUBAGENT_SPEND_DIR` still overrides it there.
- README: the credit line names the agent's creator, xnfinite.

## 0.4.2 - 2026-10-28 - says what each hook does, and that nothing leaves the machine

### Changed
- README: a table of each hook, what it does, what it changes (nothing) and the one file the mod writes; it says plainly that no data leaves the machine.
- The design comment and CLAUDE.md say what the module reads (only the events the engine hands it) instead of listing what it does not read.
- plugin.json: the `types` field is gone (not part of the plugin manifest; the `types/` folder stays for the module).

## 0.4.1 - 2026-10-28 - ctx matches Claude Code's own figure

- `context` now adds the last step's reply to its prompt. That is the number Claude Code prints as `subagent_tokens` when a subagent returns: checked live, a one-word subagent read 18,028 in both (0.4.0 said 18,024, short by its 4-token reply) and a five-tool reader 50,279 (0.4.0 said 48,801).
- The by-hand hook computes it the same way. Tests expect the new sums.

## 0.4.0 - 2026-10-28 - how full each one got

- Each row gains `context`: the last step's prompt (input + cache read + cache creation), the size of the subagent's context when it ended. `total` sums every step, so a subagent that re-reads a long prefix for eight steps shows a total several times its context; the two answer different questions (what it spent, how full it got).
- The pane row adds it: `8 turns  41k (out 2104, ctx 24k)`. `report` prints a `context` column; rows from earlier versions show `-`.
- The by-hand hook writes the same field from the transcript's newest step.
- Tests: the module tests and the fixture check the field; against 0.3.1 they fail 3 and 1.
- Minor, not patch: a new field in the rows.

## 0.3.1 - 2026-10-28 - the README tells the truth

- CLAUDE.md described the 0.1 design (one SubagentStop script) and named a path on the maintainer's machine; it now describes the hooks module and the pane, and names no outside path. No code change.

## 0.3.0 - 2026-10-28 - a pane

- A side pane, "Subagent spend", lists every subagent of the session, biggest spender first: type, the first six characters of its id, turns, total tokens, output tokens, model. It redraws on each subagent step.
- The pane opens by itself at the first subagent a session starts, once; `/subagent-spend` opens it at any time and answers with the running total. A surface that seats no panes is left alone; the rows file and status line go on.
- The module is now `hooks/register.tsx` with a state contract in `types/index.d.ts`; the rows file, its rows and the status line are unchanged.
- Tests: 11 checks (was 7), the four new ones on the pane, the command, opening once, and a value an earlier version stored.
- Minor, not patch: the module draws now and registers a command.

## 0.2.0 - 2026-10-27 - hooks module

- The plugin is now a hooks module (`hooks/register.ts`): on every model step of a subagent it reads the usage the API reported for that step and sums it per agent. Live per step, not at the subagent's end, and no transcript is read.
- The rows file and its rows are unchanged (`~/.subagent-spend/<session_id>.jsonl`, one JSON row per agent; `SUBAGENT_SPEND_DIR` overrides the folder), so `subagent_spend.py report` and `subagent_spend.py statusline` read it as before. The module rewrites the file whole after each step instead of appending.
- The running total is also put in the status line by the module itself (`subagents 2 | tok 7340 (out 120)`).
- A rows file that cannot be written is named once in the status line; the session goes on.
- The `SubagentStop` command hook is no longer registered by the plugin; it stays as the by-hand install in `kit/settings-snippet.json` for a Claude Code that loads no hooks modules. Install one of the two, not both, or every agent is counted twice.
- Tests: `hooks/register.test.ts` (6 checks under `claude plugin test`) beside the fixture test; `tests/release.sh` runs validate, both test sets and the version check, and is the release check.
- Minor, not patch: which hook the plugin registers changed.

## 0.1.1 - 2026-10-27

- Readers keep one row per `agent_id` (the last write wins), so a repeated `SubagentStop` for one agent is counted once.
- Plugin and marketplace manifests, `hooks/hooks.json`, an icon; the one-line install.
- Release check: `nightlab-release.json` names the fixture test.

## 0.1.0 - 2026-10-27

- First version: `SubagentStop` command hook summing a subagent's transcript, statusline, report, fixture test.
