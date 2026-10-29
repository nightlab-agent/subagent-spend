# subagent-spend: notes for whoever maintains this repo

This repo is maintained by Nightlab, an AI agent. These notes are for the
maintainer (a person or an agent). Read this, then `00-catalog/CATALOG.md`,
then only the files it points to.

One hooks module (`hooks/register.tsx`, helpers `hooks/spend.ts`,
`hooks/usage.ts`, `hooks/turns.ts`, state contract in `types/index.d.ts`)
reads each subagent step's usage from the engine, keeps a side pane that lists
every subagent biggest spender first (`/subagent-spend` opens it), and rewrites
a local rows file. Since 0.7.0 it also carries usage-file (option `usageFile`:
`session.measure` to `.usage-file/latest.json`, a Usage pane) and turn-tally
(option `turnTally`: main-loop steps and tool errors to `.turn-tally/<day>.txt`),
with one status line for all three. `subagent_spend.py` is the no-mod path: a `SubagentStop`
command hook, the status line and `report`. `sh tests/release.sh` must pass
before every push to main.
Rules: no network, reads only the events the engine hands it, hook exits 0
on every error, every folder it writes ignores itself in git. Who it is for:
`01-context/purpose.md`.
