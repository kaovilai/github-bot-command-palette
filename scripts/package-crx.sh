#!/bin/bash
# Builds the signed CRX3 that updates.xml points at. chromium-web-store (and
# Chrome's external-extension updater) installs from `codebase`, and only a
# CRX carries the signature Chrome verifies — the release ZIP is for manual
# side-loading only.
#
# Usage: ./scripts/package-crx.sh <path-to-private-key.pem>
#    or: EXTENSION_PRIVATE_KEY_PATH=<path> ./scripts/package-crx.sh
#
# The key's public half must match manifest.json "key" — that is what fixes the
# extension ID (`updates.xml` appid). `npm test` enforces that pairing.
set -euo pipefail
# Resolve a supplied relative key path against the caller's directory first —
# this script cd's to the repo root, so a path like ./key.pem from elsewhere
# would otherwise be looked up in the wrong place.
INVOCATION_DIR="$PWD"
KEY_PATH="${1:-${EXTENSION_PRIVATE_KEY_PATH:-}}"
if [ -n "$KEY_PATH" ] && [ "${KEY_PATH#/}" = "$KEY_PATH" ]; then
  KEY_PATH="$INVOCATION_DIR/$KEY_PATH"
fi
cd "$(dirname "$0")/.."

if [ -z "$KEY_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo "error: private key not found. Pass it as \$1 or set EXTENSION_PRIVATE_KEY_PATH." >&2
  echo "       Generate a throwaway pair for local testing with:" >&2
  echo "         openssl genrsa -out /tmp/dev-key.pem 2048" >&2
  exit 1
fi

VERSION=$(node -p "require('./manifest.json').version")
ZIP="github-bot-command-palette-v${VERSION}.zip"
CRX="github-bot-command-palette-v${VERSION}.crx"

# Always rebuild the payload from the current tree. Reusing a ZIP that happens
# to exist (an earlier version bump, a stale artifact left in the worktree)
# would sign a CRX whose manifest differs from the one being released.
./scripts/package-extension.sh

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
unzip -q "$ZIP" -d "$STAGE"

rm -f "$CRX"
npx crx3 -p "$KEY_PATH" -o "$CRX" -- "$STAGE"

# Sanity check: the extension ID implied by the signing key must equal the one
# advertised in updates.xml, or every client silently skips the update.
KEY_ID=$(node -e '
  const fs = require("fs");
  const crypto = require("crypto");
  const pub = crypto.createPublicKey(fs.readFileSync(process.argv[1], "utf8"))
    .export({ type: "spki", format: "der" });
  process.stdout.write([...crypto.createHash("sha256").update(pub).digest().subarray(0, 16)]
    .map(b => b.toString(16).padStart(2, "0")).join("")
    .split("").map(c => String.fromCharCode(97 + parseInt(c, 16))).join(""));
' "$KEY_PATH")
XML_ID=$(sed -n "s/.*appid='\([^']*\)'.*/\1/p" updates.xml | head -1)
if [ "$KEY_ID" != "$XML_ID" ]; then
  echo "error: signing key yields extension ID $KEY_ID but updates.xml advertises $XML_ID." >&2
  echo "       Regenerate manifest.json \"key\" and updates.xml from the same keypair." >&2
  exit 1
fi

echo "Packaged: $CRX ($(du -h "$CRX" | cut -f1)), extension ID $KEY_ID"
