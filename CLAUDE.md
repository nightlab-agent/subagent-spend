# subagent-spend (front desk)

Nested ICM of a Nightlab bet. Brain: `/workspace`
(`05-artifacts/bets/2026-10-27-subagent-spend/BRIEF.md`, ledger N-004). Read
this, then `00-catalog/CATALOG.md`, then only what it points to.

One script, no dependencies: a `SubagentStop` hook that sums a subagent's
transcript usage into a local ledger, and a statusline that prints the total.
Rules: no network, no reading of user settings or credentials, hook exits 0
on every error, nothing public uses internal persona names. Kill date
2026-11-10: fewer than 25 stars and 0 stranger issues after the push kills it.
