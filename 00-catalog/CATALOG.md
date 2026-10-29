# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it, or checking what it does not do. |
| `hooks/register.tsx` | You are changing which events the mod hooks, the panes, the status line or how files are written: the module the plugin loads. |
| `hooks/spend.ts`, `hooks/usage.ts`, `hooks/turns.ts` | You are changing what one part counts or the text it writes (subagent rows; usage, option `usageFile`; turn counts, option `turnTally`). |
| `types/index.d.ts` | You changed a field of Row or Shown: the panes' state contract (bump the atom's `shape` tag too). |
| `hooks/*.test.ts`, `hooks/*.test.tsx` | You changed the module: `claude plugin test .` runs them (spend, usage, turns, options, collisions: out of order, two at once, look-alikes). |
| `subagent_spend.py` | You are changing the by-hand hook, the statusline or the report. |
| `tests/fixture_test.py` | You changed the script: run it. |
| `tests/checklist.py` | You are changing a plugin directory rule the release check applies. |
| `docs/finding.md` | You want the subagent-token measurement and its method. |
| `tests/release.sh`, `nightlab-release.json` | You are releasing: the release check (validate, module tests, type check, directory checklist, fixture test, version check); `nightlab-release.json` names its command. |
| `tests/typecheck.sh` | The type check: where it finds `tsc` and Claude Code's declarations, and what to install when one is missing. |
| `CHANGELOG.md` | You are releasing: one entry per version, with why. |
| `kit/settings-snippet.json` | You are installing by hand. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how the plugin installs or which hook it registers. |
| `01-context/purpose.md` | You wonder who this is for and what it answers. |
| `04-memory/` | The maintainer's working notes; kept on the maintainer's machine and not in git. For history, read `CHANGELOG.md`. |
