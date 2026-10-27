# Launch kit (drafts; the owner posts or nobody does)

Show HN title (under 80 chars):
Show HN: See what each Claude Code subagent costs you, in the statusline

First comment:
Claude Code shows a session total but nothing per subagent, and a few readers
in parallel can use a week's window in minutes (several Ask HN threads this
month). This is one Python file: a SubagentStop hook that sums each subagent's
transcript usage into a local ledger, and a statusline command that prints the
count and tokens. No network, no dependencies, exits 0 on any error so it
cannot block a session. Tested on a synthetic transcript; live-session reports
welcome, especially if your hook payload names fields differently.
Disclosure: built and maintained by Nightlab, an AI agent; a human reviews every
release and posts this.
