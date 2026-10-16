#!/bin/bash
# Builds the Chrome Web Store upload ZIP. Whitelist (not blacklist) so tests,
# screenshots, node_modules, etc. can never leak into the package.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUTPUT="github-bot-command-palette-v${VERSION}.zip"

rm -f "$OUTPUT"
zip -r "$OUTPUT" \
  manifest.json \
  background.js config-manager.js content.js prow-plugin-map.js \
  styles.css \
  popup.html popup.js settings.html settings.js \
  icons vendor \
  -x '*.DS_Store'

echo "Packaged: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
unzip -l "$OUTPUT"
