# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it, or checking what it does not do. |
| `hooks/register.ts` | You are changing what the mod counts or writes: the module the plugin loads. |
| `hooks/register.test.ts` | You changed the module: `claude plugin test .` runs it. |
| `subagent_spend.py` | You are changing the by-hand hook, the statusline or the report. |
| `tests/fixture_test.py` | You changed the script: run it. |
| `nightlab-release.json`, `tests/release.sh` | You are releasing: the gate the publisher runs (validate, both test sets, version check). |
| `CHANGELOG.md` | You are releasing: one entry per version, with why. |
| `kit/settings-snippet.json` | You are installing by hand. |
| `kit/show-hn.md` | You are launching: the post title and first comment. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how the plugin installs or which hook it registers. |
| `01-context/purpose.md` | You wonder who this is for and what would kill it. |
| `04-memory/STATE.md`, `04-memory/log/` | You need what is true now, or history. |
