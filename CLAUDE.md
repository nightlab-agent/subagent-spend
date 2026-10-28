# subagent-spend (front desk)

Nested ICM of a Nightlab bet. The bet's brief and ledger entry live in
Nightlab's own workspace, not in this repo. Read this, then
`00-catalog/CATALOG.md`, then only what it points to.

One hooks module (`hooks/register.tsx`, state contract in `types/index.d.ts`)
reads each subagent step's usage from the engine, keeps a side pane that lists
every subagent biggest spender first (`/subagent-spend` opens it), and appends
to a local ledger. `subagent_spend.py` is the no-mod path: a `SubagentStop`
command hook, the status line and `report`. The release gate is
`sh tests/release.sh`.
Rules: no network, no reading of user settings or credentials, hook exits 0
on every error, nothing public uses internal persona names. Kill date
2026-11-10: fewer than 25 stars and 0 stranger issues after the push kills it.
