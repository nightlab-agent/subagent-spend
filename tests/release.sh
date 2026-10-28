#!/bin/sh
# Release gate: the manifest and module validate, the plugin directory
# checklist (tests/checklist.py, from mod-ready) has no FAIL, both test sets pass, and the
# version string is the same in the plugin manifest, the marketplace manifest,
# the script's first line and the changelog's newest release.
# Exit non-zero on any of them. Run from the repo root: sh tests/release.sh
# Type-check: tests/typecheck.sh, tsc --noEmit against the engine's declarations.
set -e
cd "$(dirname "$0")/.."
claude plugin validate .
claude plugin test .
sh tests/typecheck.sh
python3 -I tests/checklist.py
python3 -I tests/fixture_test.py
python3 -I - <<'EOF'
import json, re, sys
plugin = json.load(open('.claude-plugin/plugin.json'))['version']
market = json.load(open('.claude-plugin/marketplace.json'))['plugins'][0]['version']
script = re.search(r'subagent-spend (\d+\.\d+\.\d+)', open('subagent_spend.py').read(300)).group(1)
changelog = re.search(r'^## (\d+\.\d+\.\d+) ', open('CHANGELOG.md').read(), re.M).group(1)
versions = {'plugin.json': plugin, 'marketplace.json': market, 'subagent_spend.py': script, 'CHANGELOG.md': changelog}
if len(set(versions.values())) != 1:
    sys.exit(f"version strings differ: {versions}")
print(f"version check: all four say {plugin}")
EOF
echo "release gate: validate, module tests, fixture test and version check passed"
