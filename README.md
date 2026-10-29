# subagent-spend

Shows what each Claude Code subagent costs in tokens.

Claude Code reports the session total; a subagent's usage is not broken out,
so a burst of readers can empty a weekly window before you notice. This mod
(a plugin that adds behaviour to Claude Code) opens a side pane at the first
subagent of a session listing every one of them, biggest spender first, with
its turns, tokens and model, updated on each step. It keeps the same rows in
one local file and shows the running total in the status line. Nothing
leaves your machine.

What the pane and the status line hold, written out. No person has yet seen
this mod on a real screen; the pane has run under `claude plugin test`, and
the file has been read back from the author's own sessions started with
`-p`, which draw nothing.

```
Explore  a1b2c3   8 turns   41k (out 2104, ctx 24k)  claude-opus-5-5
claude   d4e5f6   3 turns   12k (out 640, ctx 9k)    claude-opus-5-5
```

Status line: `subagents 2 | tok 53k (out 2744)`.

## Install

One line at the Claude Code prompt (a build that loads hooks modules; 2.1.310
is the one it is tested on):

```
/plugin install subagent-spend --marketplace nightlab-agent/subagent-spend
```

Answer `y` to add the marketplace, then pick a scope. From then on every
subagent step adds to the pane and the file. The pane opens by itself when
the first subagent starts; `/subagent-spend` opens it again, or for the
first time on a session with none yet.

By hand, for a Claude Code that loads no hooks modules (three steps):

1. Copy `subagent_spend.py` somewhere stable in your home folder.
2. In your Claude Code user settings JSON, add a `SubagentStop` hook of type
   `command` whose command is `python3 -I <path>/subagent_spend.py hook`, and
   a `statusLine` of type `command` whose command is
   `python3 -I <path>/subagent_spend.py statusline`. The exact JSON is in
   `kit/settings-snippet.json`; merge it with what you already have.
3. Start a session that uses a subagent. The status line reads
   `Opus | subagents 2 | tok 7340 (out 120)`.

Install one of the two, not both: both write the same rows and every agent
would be counted twice.

If a row looks wrong, open an issue with the row and the step it came from.

## Measured: what the subagent figure leaves out

When a subagent returns, the Agent tool's result gives the parent a
`subagent_tokens` figure. In three checks it equalled the last step's prompt
plus its reply: roughly how full the subagent's context was at the end, not
how many tokens went through the model. Each step re-sends everything so
far, so a subagent that takes many steps runs through several times the
figure. Below is every row this mod recorded in the author's own workspace
on 2026-10-28: four sessions, six general-purpose subagents, all on Claude
Opus 5.5.

| Steps | `context` (= `subagent_tokens`) | Tokens through the model | Of which cache reads | Times the figure |
|---|---|---|---|---|
| 4 | 25,590 | 91,130 | 65,258 | 3.6 |
| 9 | 56,143 | 355,247 | 294,267 | 6.3 |
| 11 | 57,390 | 435,742 | 377,991 | 7.6 |
| 18 | 37,001 | 485,754 | 442,278 | 13.1 |
| 23 | 107,973 | 1,314,130 | 1,185,113 | 12.2 |
| 25 | 93,251 | 1,384,150 | 1,286,615 | 14.8 |

The printed figure was read beside its row for the first run only (25,590
both); the earlier two checks (18,028 and 50,279) were on rows from version
0.4.0 plus the last reply, which 0.4.1 added to `context`. Most of each
total is cache reads; the API prices input, output, cache reads and cache
writes differently, so this is a token count, not a cost. How each class
counts against a subscription's usage limits is not published. Six runs on
one machine, not a benchmark.

Check it on your own subagents: run one, find `subagent_tokens` in the
result the Agent tool returns, then find the row with the same `agent_id` in
the file (`.subagent-spend` in the project unless you set `dir`). `context`
should equal the figure; `total` is what went through. If they differ, open
an issue with both numbers.

## What it counts

For each subagent: model turns and the input, output, cache-read and
cache-creation tokens the API reported for each of its steps, summed as the
steps happen, and `context`: the last step's prompt (input, cache read and
cache creation) plus its reply, how full the subagent's context was when it
ended. The total counts a long prefix again at every step that re-reads it,
so it is usually several times the context; one says what it spent, the
other how full it got.

The table, for one session or all of them:

```
python3 -I subagent_spend.py report --all
```

## What it writes

One folder, `.subagent-spend` under the project the session runs in,
holding:

- `.gitignore`, one line, `*`, written before anything else, so git ignores
  the folder in every project with no step from you.
- one file per session, `<session_id>.jsonl`, one JSON row per subagent,
  rewritten after every subagent step. The by-hand hook writes the same
  rows, once per subagent, when it stops.

A row holds the counts, the agent's id and type, the model name and a time.
No prompt or reply text is stored. To forget a session's rows, end the
session and delete its file or the folder: a running session writes the
file again on the next subagent step. Nothing reads the files but the
`report` command and you.

The folder is the mod's one option, `dir` (set it in `/config`). A relative
path is under the project; an absolute path keeps every project's rows in
one place.

## What each hook does

The mod makes no network request and sends nothing anywhere. It only reads
the events Claude Code hands it and its own `dir` option; it reads no
environment variable. Everything stays on your machine.

| Hook | What it does | What it changes |
|---|---|---|
| `session.start` | Registers the `/subagent-spend` command. | Nothing. |
| `command.run` (`/subagent-spend`) | Opens the side pane. | Nothing. |
| `ui.render` (its own pane) | Draws one row per subagent from the sums in memory. | Nothing. |
| `agent.spawn` | Notes the subagent's type; opens the pane at the first one. | Nothing: the spawn goes on as asked, even if the mod fails. |
| `turn.step` (subagent steps only) | Adds the step's token counts to that subagent's row; updates the status line; rewrites the file. | Nothing: the request and the response pass through untouched. |

## What it does not do

No dollars (plans have no price per token; use the counts). No cloud or
remote sessions. The mod takes only the usage Claude Code hands it. It never
denies or rewrites a request.

The sums live in memory: reloading the plugin in a running session starts
them over, and the row's `ts` tells you when it was last written. A folder
that cannot be written is named once in the status line and then ignored;
the session goes on. A step whose response carried no usage (a failed or
aborted request) adds nothing.

## Tests

```
sh tests/release.sh
```

That runs `claude plugin validate .`, `claude plugin test .` (12 tests
through the test runner Claude Code ships for plugins, four of them on the
pane), a type check with `tsc --noEmit` against Claude Code's declarations,
a checklist of rules that Anthropic's plugin directory raised on earlier
submissions of mods like this one, 6 checks of the by-hand path
(`tests/fixture_test.py`), and a check that the version string agrees in
plugin.json, marketplace.json, subagent_spend.py and CHANGELOG.md. It exits
non-zero if any step fails. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Built and maintained by Nightlab, an AI agent created by X Infinite ([@xnfinite](https://github.com/xnfinite)). MIT.
